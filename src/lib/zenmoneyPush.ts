/**
 * Reverse mapper: local `Transaction` edit → Zenmoney `ZenTransaction`.
 *
 * Phase 1 MVP scope. We push only the "safe" edit fields where the
 * inverse mapping is unambiguous:
 *
 *   • date            (direct YYYY-MM-DD)
 *   • payee           (string|null)
 *   • brand           (in dictionary → merchant id; not in dictionary →
 *                       fallback to free-text `payee` field)
 *   • comment         (string|null)
 *   • amount          (replaces the amount on the side that already has it)
 *   • currency        (replaces the instrument on the side that already has it)
 *   • category        (resolved to a single tag id by title)
 *   • subcategory     (resolved as a child tag where parent's title matches)
 *
 *   • kind change        — supported for the single-leg flips
 *                          Расход ↔ Доход ↔ Возврат: the money moves
 *                          between the income/outcome legs of the SAME
 *                          account (or, for income↔refund, stays put and
 *                          only the category flavour changes).
 *
 * The following are deliberately NOT supported yet (the edit stays in
 * the local overlay; user gets a clear "skipped" reason):
 *
 *   • kind change to/from
 *     «Перевод»          — requires a second account
 *   • kind change on an
 *     FX row             — non-zero opIncome/opOutcome; flipping legs
 *                          would need to re-map operational instruments
 *   • account change     — legs must stay consistent
 *   • outcomeAccount /
 *     incomeAccount      — used together with kind=transfer changes
 *
 * Brand handling: Zenmoney has two counterparty fields on a transaction
 * — `merchant` (id-ref into the merchant dictionary, the curated brand
 * catalogue) and `payee` (free-text). When the user picks a name that
 * matches an existing merchant, we set `merchant`. When they type a
 * name that's NOT in the dictionary, we don't create a new merchant
 * entity (that has its own catalogue-side concerns); instead we store
 * the string into `payee` and clear `merchant`. Round-trip works:
 * after the next sync, the forward mapper sees `merchant: null` +
 * `payee: "MyCustomShop"` and surfaces it as the brand in the UI.
 *
 * Strategy: take the ORIGINAL `ZenTransaction` straight from cache and
 * apply only the fields the user actually touched. This preserves all
 * Zenmoney-specific fields we don't model locally (qrCode, latitude,
 * opIncome/opOutcome for FX, payeeRaw etc.) so a round-trip can't
 * accidentally blank them out.
 */

import { pushDiff, type PushPayload } from "./zenmoney";
import type {
  ZenAccount,
  ZenDeletion,
  ZenDiffResponse,
  ZenTag,
  ZenTransaction,
} from "./zenmoney";
import type { ZenCache } from "./zenmoneyCache";
import type { TransactionEdit } from "../store/useEditsStore";
import type { TxKind } from "../types";

export interface PushItem {
  id: string;
  /** Reconstructed ZenTransaction ready to send. */
  zen: ZenTransaction;
}

export interface PushBuildResult {
  /** Ready-to-send transactions. */
  toPush: PushItem[];
  /** Edits we couldn't transform — paired with a human-readable reason. */
  skipped: { id: string; reason: string }[];
}

/** Synthetic categories minted in the forward mapper. They have no
 *  real Zenmoney tag, so pushing them is impossible. */
const SYNTHETIC_CATEGORIES = new Set(["Долг", "Перевод"]);

/**
 * Replays the forward-mapper classification for a raw ZenTransaction so
 * we can tell what `kind` / `account` / `outcomeAccount` / `incomeAccount`
 * our local model originally derived from it. Used to decide whether an
 * overlay field is a *real* change or just an inherited copy from the
 * Edit-modal (which currently stashes every field into the patch).
 *
 * Mirrors `zenmoneyMap.ts` — including the refund heuristic: an
 * income-side movement tagged with an *expense* category
 * (`tag.showOutcome && !tag.showIncome`) is classified as `refund`.
 */
function classifyOriginal(
  zt: ZenTransaction,
  accountsById: Map<string, ZenAccount>,
  tagsById: Map<string, ZenTag>
): { kind: TxKind; account: string; outAcc: string; inAcc: string } {
  const outcome = zt.outcome || 0;
  const income = zt.income || 0;
  const outAcc = accountsById.get(zt.outcomeAccount)?.title || "";
  const inAcc = accountsById.get(zt.incomeAccount)?.title || "";
  const isTransfer =
    outcome > 0 && income > 0 && zt.outcomeAccount !== zt.incomeAccount;
  if (isTransfer) {
    return { kind: "transfer", account: outAcc, outAcc, inAcc };
  }
  if (outcome > 0) {
    return { kind: "expense", account: outAcc, outAcc, inAcc };
  }
  // Income-side. Check for the refund heuristic — same rule as the
  // forward mapper so this round-trips losslessly.
  let kind: TxKind = "income";
  const firstTag = zt.tag && zt.tag.length > 0 ? tagsById.get(zt.tag[0]) : null;
  if (firstTag && firstTag.showOutcome && !firstTag.showIncome) {
    kind = "refund";
  }
  return { kind, account: inAcc, outAcc, inAcc };
}

/**
 * Build Zenmoney `deletion` entries for locally-deleted transactions.
 *
 * Only ids that still exist in the cloud cache are emitted — once the
 * cloud no longer has the transaction (already deleted, or never
 * synced), there's nothing to delete and we silently skip it. Each
 * deletion carries the transaction's `user` (the cloud requires it)
 * and a fresh `stamp` (unix seconds).
 */
export function buildDeletions(
  deletedIds: Iterable<string>,
  cache: ZenCache
): ZenDeletion[] {
  const byId = new Map(cache.transactions.map((t) => [t.id, t]));
  const stamp = Math.floor(Date.now() / 1000);
  const out: ZenDeletion[] = [];
  for (const id of deletedIds) {
    const zt = byId.get(id);
    if (!zt) continue; // not in cloud cache — nothing to delete
    if (zt.deleted) continue; // already a tombstone
    out.push({ id, object: "transaction", user: zt.user, stamp });
  }
  return out;
}

export interface Resurrection {
  /** Original (now permanently tombstoned) id — used to drop the spent
   *  snapshot once the re-create succeeds. */
  oldId: string;
  /** A fresh transaction (NEW id) to create in the cloud. */
  tx: ZenTransaction;
}

/**
 * Build "resurrection" re-creates for restored transactions.
 *
 * Zenmoney tombstones are sticky: re-pushing a deleted id (even with
 * `deleted:false`) is rejected — the server keeps it deleted (verified
 * against the API). So we revive a row by **creating a copy with a new
 * id**, preserving every field (payee, merchant, tags, amounts, date…).
 *
 * Derived purely from state, so it's safe to recompute each push:
 *   • id still hidden locally (in `deletedIds`) → skip (keep it deleted)
 *   • id LIVE in the cloud cache                → skip (deletion was never
 *     pushed — the original is still there)
 *   • otherwise (restored + gone/tombstoned)    → re-create under a new id
 *
 * NB: a full sync returns deleted rows as `deleted:true` tombstones, which
 * land in `cache.transactions`. A tombstone does NOT count as "present" —
 * we only treat a LIVE (deleted !== true) row as still in the cloud.
 *
 * After a successful push the caller MUST drop the snapshots for the
 * returned `oldId`s, otherwise the next push would create duplicates.
 */
export function buildResurrections(
  payloads: Record<string, ZenTransaction>,
  deletedIds: Iterable<string>,
  cache: ZenCache,
  stampSeconds: number,
  mintId: () => string
): Resurrection[] {
  const deletedSet = new Set(deletedIds);
  const liveInCache = new Set(
    cache.transactions.filter((t) => !t.deleted).map((t) => String(t.id))
  );
  const out: Resurrection[] = [];
  for (const id of Object.keys(payloads)) {
    if (deletedSet.has(id)) continue;
    if (liveInCache.has(id)) continue;
    out.push({
      oldId: id,
      tx: {
        ...payloads[id],
        id: mintId(),
        deleted: false,
        changed: stampSeconds,
      },
    });
  }
  return out;
}

/**
 * Walk every pending edit and classify it as push-ready or skipped.
 * Pure function — no IO, no API calls; can be called from a preview UI.
 */
export function buildPushItems(
  edits: Record<string, TransactionEdit>,
  cache: ZenCache
): PushBuildResult {
  const transactionsById = new Map(cache.transactions.map((t) => [t.id, t]));
  const tagsByTitle = new Map<string, ZenTag[]>();
  for (const t of cache.tags) {
    if (t.archive) continue;
    const list = tagsByTitle.get(t.title) ?? [];
    list.push(t);
    tagsByTitle.set(t.title, list);
  }
  const tagsById = new Map(cache.tags.map((t) => [t.id, t]));
  const instrumentsBySymbol = new Map(
    cache.instruments.map((i) => [i.shortTitle, i])
  );
  const accountsById = new Map(cache.accounts.map((a) => [a.id, a]));
  // Merchant dictionary indexed by title (case-insensitive trimmed key
  // for tolerance). `brand` edits get resolved to a merchant id through
  // this map. New brand titles (not in the dictionary) are refused —
  // creating a merchant entity is outside Phase 1 scope.
  const merchantsByTitle = new Map<string, string>();
  for (const m of cache.merchants) {
    const key = (m.title || "").trim().toLowerCase();
    if (!key) continue;
    // First-seen wins — Zenmoney shouldn't have duplicates, but be safe.
    if (!merchantsByTitle.has(key)) merchantsByTitle.set(key, m.id);
  }

  const toPush: PushItem[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const [id, edit] of Object.entries(edits)) {
    const original = transactionsById.get(id);
    if (!original) {
      skipped.push({
        id,
        reason:
          "оригинал не найден в локальном кэше API (нужен ре-синк перед Push)",
      });
      continue;
    }
    if (original.deleted) {
      skipped.push({ id, reason: "транзакция помечена удалённой в облаке" });
      continue;
    }

    // Hard "no" for unsupported edit fields — but ONLY when the value
    // actually differs from what the forward mapper would have derived
    // from the original. The Edit-modal currently stashes every field
    // into the patch even when the user didn't touch it (so a payee-
    // only edit still carries `kind` / `account` / both legs unchanged).
    // Comparing against the original lets us treat those as no-ops.
    const orig = classifyOriginal(original, accountsById, tagsById);
    const targetKind: TxKind = (edit.kind as TxKind | undefined) ?? orig.kind;

    // ── Kind transition (Phase 2: expense ↔ income ↔ refund) ──────────
    // These three are single-leg, same-account flips: the money moves
    // between the income and outcome legs of the SAME account, or (for
    // income↔refund) stays put and only the category flavour differs.
    // `origLeg` / `targetLeg` say which leg holds the money before/after.
    // Transfers (need a 2nd account) and FX rows (operational op-amounts)
    // are still out of scope — they're refused below.
    const origLeg: "income" | "outcome" =
      orig.kind === "expense" ? "outcome" : "income";
    const targetLeg: "income" | "outcome" =
      targetKind === "expense" ? "outcome" : "income";
    if (targetKind !== orig.kind) {
      if (orig.kind === "transfer" || targetKind === "transfer") {
        skipped.push({
          id,
          reason:
            "Смена типа на «Перевод» или с него пока не поддерживается — отредактируйте в мобильном приложении.",
        });
        continue;
      }
      // FX guard: a NON-ZERO operational amount means the transaction's
      // currency differs from the account's (op-amount is the foreign
      // value). Note Zenmoney stores 0 (not null) for the unused leg of
      // a plain same-currency row, so we must test `> 0`, not non-null —
      // otherwise every ordinary expense (opOutcome: 0) would be skipped.
      if (
        (original.opIncome || 0) > 0 ||
        (original.opOutcome || 0) > 0
      ) {
        skipped.push({
          id,
          reason:
            "Операция в валюте, отличной от счёта (мультивалютная) — смену типа пока не поддерживаем.",
        });
        continue;
      }
    }
    if (edit.account !== undefined && edit.account !== orig.account) {
      skipped.push({
        id,
        reason:
          "Phase 1 не поддерживает смену счёта операции. Отредактируйте в мобильном приложении.",
      });
      continue;
    }
    // Side-fields `outcomeAccount` / `incomeAccount` only matter for
    // *transfers* — for income/expense/refund rows the canonical
    // account is `account`, and the side-fields are auxiliary. Pre-
    // bugfix overlays sometimes stashed those side-fields with noise
    // values (e.g. "" for the "unused" side of an expense), which
    // would falsely look like an account change here. Skip the
    // comparison unless the effective kind is "transfer".
    const effectiveKind = (edit.kind as TxKind | undefined) ?? orig.kind;
    if (effectiveKind === "transfer") {
      if (
        edit.outcomeAccount !== undefined &&
        edit.outcomeAccount !== orig.outAcc
      ) {
        skipped.push({
          id,
          reason:
            "Phase 1 не поддерживает смену счёта-источника. Отредактируйте в мобильном приложении.",
        });
        continue;
      }
      if (
        edit.incomeAccount !== undefined &&
        edit.incomeAccount !== orig.inAcc
      ) {
        skipped.push({
          id,
          reason:
            "Phase 1 не поддерживает смену счёта-получателя. Отредактируйте в мобильном приложении.",
        });
        continue;
      }
    }

    // Refuse synthetic-category edits — Zen has no tag with that name.
    if (edit.category && SYNTHETIC_CATEGORIES.has(edit.category)) {
      skipped.push({
        id,
        reason: `категория "${edit.category}" — локальный ярлык, в Zenmoney такого тега нет`,
      });
      continue;
    }

    // ── Build the patched ZenTransaction ──────────────────────────────
    const zen: ZenTransaction = { ...original };

    // Apply a kind flip by moving the money between legs of the SAME
    // account (verified above: non-transfer rows have
    // incomeAccount === outcomeAccount, no FX op-amounts). The account
    // ids stay as-is (both already point to the same account); we move
    // the amount, the instrument and the bank-reconciliation id onto the
    // target leg and zero the source leg. income↔refund don't move legs
    // (origLeg === targetLeg) — only the category tag flavour differs,
    // handled by the category edit below.
    if (targetKind !== orig.kind && origLeg !== targetLeg) {
      if (targetLeg === "income") {
        zen.income = original.outcome;
        zen.incomeInstrument = original.outcomeInstrument;
        zen.incomeBankID = original.outcomeBankID;
        zen.outcome = 0;
        zen.outcomeBankID = null;
      } else {
        zen.outcome = original.income;
        zen.outcomeInstrument = original.incomeInstrument;
        zen.outcomeBankID = original.incomeBankID;
        zen.income = 0;
        zen.incomeBankID = null;
      }
    }

    if (edit.date !== undefined) {
      // We only accept ISO YYYY-MM-DD here — the EditTransactionModal
      // already guards on this, but be defensive in case of stale data.
      if (/^\d{4}-\d{2}-\d{2}$/.test(edit.date)) {
        zen.date = edit.date;
      }
    }
    if (edit.payee !== undefined) {
      zen.payee = edit.payee || null;
    }
    if (edit.comment !== undefined) {
      zen.comment = edit.comment || null;
    }

    // Brand handling. Two paths:
    //   1) The user picked a known brand (exists in the merchant
    //      dictionary) → set `merchant` to its id. Leave `payee`
    //      alone so the bank's original printout is preserved.
    //   2) The user typed a free-text name not in the dictionary
    //      → store it on the `payee` field (Zenmoney's free-text
    //      counterparty) and clear `merchant`. This avoids
    //      creating phantom merchant entities and matches what the
    //      mobile app does for unmatched bank lines.
    if (edit.brand !== undefined) {
      const wanted = (edit.brand || "").trim();
      if (!wanted) {
        // User cleared the field entirely → drop the merchant ref
        // and the free-text payee. (Leaving payee would surface
        // the bank's raw text again — usually not what "clear"
        // means.)
        zen.merchant = null;
        zen.payee = null;
      } else {
        const merchantId = merchantsByTitle.get(wanted.toLowerCase());
        if (merchantId) {
          zen.merchant = merchantId;
          // Known brand: keep zen.payee untouched (bank's original).
        } else {
          // Free-text fallback. This is intentional — see the
          // brand-handling block in the file-top JSDoc.
          zen.merchant = null;
          zen.payee = wanted;
        }
      }
    }

    // Amount + currency go on `targetLeg` — the leg that holds the money
    // after any kind flip (for unchanged rows targetLeg === the original
    // non-zero leg, so this matches the old behaviour). This runs AFTER
    // the leg-move above, so an edited amount overrides the moved value.
    if (edit.amount !== undefined) {
      if (targetLeg === "outcome") zen.outcome = edit.amount;
      else zen.income = edit.amount;
    }

    if (edit.currency !== undefined) {
      const instr = instrumentsBySymbol.get(edit.currency);
      if (instr) {
        if (targetLeg === "outcome") zen.outcomeInstrument = instr.id;
        else zen.incomeInstrument = instr.id;
      } else {
        skipped.push({
          id,
          reason: `валюта "${edit.currency}" не найдена в инструментах Zenmoney`,
        });
        continue;
      }
    }

    if (edit.category !== undefined) {
      const resolved = resolveTagId(
        edit.category,
        edit.subcategory ?? null,
        tagsByTitle,
        tagsById
      );
      if (!resolved) {
        skipped.push({
          id,
          reason: `категория "${edit.category}"${edit.subcategory ? ` / "${edit.subcategory}"` : ""} не найдена в тегах Zenmoney`,
        });
        continue;
      }
      zen.tag = [resolved];
    } else if (edit.subcategory !== undefined && original.tag?.[0]) {
      // The user changed only the subcategory. Try to find a sibling tag
      // with the same parent. If we can't, skip — better than silently
      // dropping the subcategory change.
      const parentTagId = original.tag[0];
      const parentTag = tagsById.get(parentTagId);
      const parentTitle = parentTag?.parent
        ? tagsById.get(parentTag.parent)?.title || parentTag.title
        : parentTag?.title;
      const resolved = parentTitle
        ? resolveTagId(parentTitle, edit.subcategory, tagsByTitle, tagsById)
        : null;
      if (!resolved) {
        skipped.push({
          id,
          reason: `подкатегория "${edit.subcategory}" не найдена под текущим родителем`,
        });
        continue;
      }
      zen.tag = [resolved];
    }

    // Server uses `changed` for last-write-wins conflict resolution.
    // Setting it to "now" ensures our edit wins over anything older on
    // the server. (If the server has a newer copy, our push will lose
    // — that's a Phase 1.1 conflict-detection concern.)
    zen.changed = Math.floor(Date.now() / 1000);

    toPush.push({ id, zen });
  }

  return { toPush, skipped };
}

/**
 * Look up a tag id by category name (and optional subcategory).
 *
 *   • no subcategory       → exact title match (top-level or any depth)
 *   • with subcategory     → child whose own title === subcategory AND
 *                            whose parent's title === category
 *
 * Returns the tag id, or null if no match.
 */
function resolveTagId(
  category: string,
  subcategory: string | null,
  tagsByTitle: Map<string, ZenTag[]>,
  tagsById: Map<string, ZenTag>
): string | null {
  if (!subcategory) {
    // Prefer a top-level tag (no parent) when there's ambiguity, falling
    // back to any match. Zenmoney rarely has two tags with the same
    // title in different branches, but we want to be deterministic.
    const candidates = tagsByTitle.get(category) ?? [];
    if (candidates.length === 0) return null;
    const topLevel = candidates.find((t) => !t.parent);
    return (topLevel ?? candidates[0]).id;
  }
  // Subcategory present — look for a child whose parent has the right title.
  const subs = tagsByTitle.get(subcategory) ?? [];
  for (const sub of subs) {
    if (!sub.parent) continue;
    const parent = tagsById.get(sub.parent);
    if (parent?.title === category) return sub.id;
  }
  return null;
}

/**
 * Send the prepared push batch. Returns the server's response so the
 * caller can merge the canonical `changed` timestamps back into cache.
 */
export async function sendPush(
  token: string,
  serverTimestamp: number,
  items: PushItem[],
  deletions: ZenDeletion[] = [],
  resurrections: ZenTransaction[] = []
): Promise<ZenDiffResponse> {
  const payload: PushPayload = {
    transaction: [...items.map((i) => i.zen), ...resurrections],
    ...(deletions.length > 0 ? { deletion: deletions } : {}),
  };
  // Debug aid: surface the full payload in DevTools so it's easy to
  // verify which fields actually landed in the request body. Disabled
  // automatically in production (Vite sets `import.meta.env.PROD`).
  if (!import.meta.env.PROD) {
    console.groupCollapsed(
      `[Zenmoney push] sending ${items.length} transaction(s)`
    );
    for (const item of items) {
      console.log(item.id, {
        payee: item.zen.payee,
        merchant: item.zen.merchant,
        comment: item.zen.comment,
        date: item.zen.date,
        outcome: item.zen.outcome,
        income: item.zen.income,
        tag: item.zen.tag,
        changed: item.zen.changed,
      });
    }
    console.groupEnd();
  }
  return pushDiff(token, serverTimestamp, payload);
}
