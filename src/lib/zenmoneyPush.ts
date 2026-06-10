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
 * Supported now: kind change expense↔income↔refund, kind change to/from
 * «Перевод» and editing a transfer's accounts (single-currency only), and
 * account change for single-leg rows (same currency).
 *
 * The following are deliberately NOT supported yet (the edit stays in
 * the local overlay; user gets a clear "skipped" reason):
 *
 *   • FX rows            — non-zero opIncome/opOutcome (currency differs
 *                          from the account); re-mapping operational
 *                          instruments is out of scope
 *   • cross-currency     — moving a row to an account in another currency,
 *                          or a transfer between accounts of different
 *                          currencies (needs op-amounts)
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

/** Apply the always-safe scalar edits (date, comment) onto a built patch. */
function applyDateComment(zen: ZenTransaction, edit: TransactionEdit): void {
  if (edit.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(edit.date)) {
    zen.date = edit.date;
  }
  if (edit.comment !== undefined) {
    zen.comment = edit.comment || null;
  }
}

/**
 * Build a TRANSFER ZenTransaction (Branch A): money leaves `outcomeAccount`
 * and lands on `incomeAccount`. Single-currency only — both accounts must
 * share an instrument (the UI offers one amount field). Returns a skip
 * reason for FX rows, missing/same accounts, or a cross-currency pair.
 * The accounts come from the edit overlay (titles) and fall back to the
 * original's legs so editing only the amount/comment of an existing
 * transfer still works.
 */
function buildTransferTarget(
  original: ZenTransaction,
  edit: TransactionEdit,
  orig: { outAcc: string; inAcc: string },
  accountsByTitle: Map<string, ZenAccount>
): { zen?: ZenTransaction; skip?: string } {
  if ((original.opIncome || 0) > 0 || (original.opOutcome || 0) > 0) {
    return {
      skip: "перевод с операцией в другой валюте (мультивалюта) пока не поддерживается — отредактируйте в приложении",
    };
  }
  const srcTitle = edit.outcomeAccount ?? orig.outAcc;
  const dstTitle = edit.incomeAccount ?? orig.inAcc;
  const src = accountsByTitle.get(srcTitle);
  const dst = accountsByTitle.get(dstTitle);
  if (!src) return { skip: `счёт-источник "${srcTitle}" не найден в Zenmoney` };
  if (!dst) return { skip: `счёт-получатель "${dstTitle}" не найден в Zenmoney` };
  if (src.id === dst.id) {
    return { skip: "перевод между одним и тем же счётом невозможен" };
  }
  if (src.instrument !== dst.instrument) {
    return {
      skip: "мультивалютный перевод (разные валюты счетов) пока не поддерживается — отредактируйте в приложении",
    };
  }
  const amount = edit.amount ?? (original.outcome || original.income);
  const zen: ZenTransaction = {
    ...original,
    outcome: amount,
    income: amount,
    outcomeAccount: src.id,
    incomeAccount: dst.id,
    outcomeInstrument: src.instrument,
    incomeInstrument: dst.instrument,
    opOutcome: 0,
    opIncome: 0,
    opOutcomeInstrument: null,
    opIncomeInstrument: null,
    // The source leg keeps any existing bank-reconciliation id; the
    // freshly-synthesised destination leg has none.
    outcomeBankID: original.outcome > 0 ? original.outcomeBankID : original.incomeBankID,
    incomeBankID: null,
    tag: null, // a transfer has no category in Zenmoney
    merchant: null,
    payee: null, // a transfer has no counterparty
  };
  return { zen };
}

/**
 * Collapse a TRANSFER onto a single account (Branch B): transfer →
 * expense keeps the outcome leg; transfer → income/refund keeps the
 * income leg. The result account comes from the edit (else the kept
 * leg's account); same-currency only. Category is resolved from the
 * edit when present, otherwise the row goes untagged (a refund without
 * an expense tag round-trips as plain income — acceptable).
 */
function collapseTransfer(
  original: ZenTransaction,
  edit: TransactionEdit,
  orig: { outAcc: string; inAcc: string },
  targetKind: TxKind,
  accountsByTitle: Map<string, ZenAccount>,
  tagsByTitle: Map<string, ZenTag[]>,
  tagsById: Map<string, ZenTag>
): { zen?: ZenTransaction; skip?: string } {
  if ((original.opIncome || 0) > 0 || (original.opOutcome || 0) > 0) {
    return {
      skip: "перевод с операцией в другой валюте (мультивалюта) пока не поддерживается — отредактируйте в приложении",
    };
  }
  const keepLeg: "outcome" | "income" =
    targetKind === "expense" ? "outcome" : "income";
  const keepInstr =
    keepLeg === "outcome" ? original.outcomeInstrument : original.incomeInstrument;
  const wantTitle = edit.account ?? (keepLeg === "outcome" ? orig.outAcc : orig.inAcc);
  const acc = accountsByTitle.get(wantTitle);
  if (!acc) return { skip: `счёт "${wantTitle}" не найден в Zenmoney` };
  if (acc.instrument !== keepInstr) {
    return {
      skip: "смена счёта на счёт в другой валюте (мультивалюта) пока не поддерживается — отредактируйте в приложении",
    };
  }
  const amount =
    edit.amount ?? (keepLeg === "outcome" ? original.outcome : original.income);
  const zen: ZenTransaction = { ...original };
  if (keepLeg === "outcome") {
    zen.outcome = amount;
    zen.income = 0;
    zen.outcomeBankID = original.outcomeBankID;
    zen.incomeBankID = null;
  } else {
    zen.income = amount;
    zen.outcome = 0;
    zen.incomeBankID = original.incomeBankID;
    zen.outcomeBankID = null;
  }
  // Single-leg invariant: both legs name the same account & instrument.
  zen.outcomeAccount = acc.id;
  zen.incomeAccount = acc.id;
  zen.outcomeInstrument = keepInstr;
  zen.incomeInstrument = keepInstr;
  zen.opOutcome = 0;
  zen.opIncome = 0;
  zen.opOutcomeInstrument = null;
  zen.opIncomeInstrument = null;
  if (edit.category && !SYNTHETIC_CATEGORIES.has(edit.category)) {
    const resolved = resolveTagId(
      edit.category,
      edit.subcategory ?? null,
      tagsByTitle,
      tagsById
    );
    if (!resolved) {
      return { skip: `категория "${edit.category}" не найдена в тегах Zenmoney` };
    }
    zen.tag = [resolved];
  } else {
    zen.tag = null;
  }
  return { zen };
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
 * A DETERMINISTIC new id derived from the tombstoned old id. Using a
 * stable derived id (instead of a random one) makes resurrection
 * idempotent: re-pushing the same restored row hits the SAME new id, so
 * the server upserts it rather than creating a duplicate. This is the
 * safety net against ever spamming copies if the post-push snapshot prune
 * doesn't land. UUID-shaped (Zenmoney ids are UUIDs); FNV-1a fill — not
 * cryptographic, just stable + collision-free enough against real ids.
 */
export function resurrectionId(oldId: string): string {
  const bytes: number[] = [];
  let h = 0x811c9dc5;
  for (let i = 0; i < 16; i++) {
    h ^= i + 0x9e;
    h = Math.imul(h, 0x01000193);
    for (let j = 0; j < oldId.length; j++) {
      h ^= oldId.charCodeAt(j);
      h = Math.imul(h, 0x01000193);
    }
    bytes.push((h >>> 0) & 0xff);
  }
  // Make it a valid RFC-4122 v4-shaped UUID — Zenmoney rejects ids that
  // aren't proper UUIDs. Set the version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0"));
  return (
    `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-` +
    `${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-` +
    `${hex.slice(10, 16).join("")}`
  );
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
  mintId: (oldId: string) => string = resurrectionId
): Resurrection[] {
  const deletedSet = new Set(deletedIds);
  const liveInCache = new Set(
    cache.transactions.filter((t) => !t.deleted).map((t) => String(t.id))
  );
  const out: Resurrection[] = [];
  for (const id of Object.keys(payloads)) {
    if (deletedSet.has(id)) continue;
    if (liveInCache.has(id)) continue; // original still live → nothing to do
    const newId = mintId(id);
    // Idempotency: if the deterministic copy is already live in the cloud,
    // the resurrection already landed — skip it (its snapshot gets pruned).
    if (liveInCache.has(newId)) continue;
    out.push({
      oldId: id,
      tx: {
        ...payloads[id],
        id: newId,
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
  // Reverse map for resolving an edited account NAME back to its id (account
  // changes push to cloud). Titles should be unique per user, but if two
  // collide prefer the non-archived one — that's the account the user means.
  const accountsByTitle = new Map<string, ZenAccount>();
  for (const a of cache.accounts) {
    const prev = accountsByTitle.get(a.title);
    if (!prev || (prev.archive && !a.archive)) accountsByTitle.set(a.title, a);
  }
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

    const origIsTransfer = orig.kind === "transfer";
    const targetIsTransfer = targetKind === "transfer";

    // ── Branch A: target is a transfer ────────────────────────────────
    // Covers flip → transfer AND editing the accounts/amount of an
    // existing transfer (transfer → transfer). Both legs are rebuilt by
    // buildTransferTarget; single-currency only, FX is refused inside.
    if (targetIsTransfer) {
      const built = buildTransferTarget(original, edit, orig, accountsByTitle);
      if (built.skip) {
        skipped.push({ id, reason: built.skip });
        continue;
      }
      const zen = built.zen!;
      applyDateComment(zen, edit);
      zen.changed = Math.floor(Date.now() / 1000);
      toPush.push({ id, zen });
      continue;
    }

    // ── Branch B: transfer → single-leg (expense/income/refund) ───────
    // Collapse the two legs onto one account; FX refused inside.
    if (origIsTransfer) {
      const built = collapseTransfer(
        original,
        edit,
        orig,
        targetKind,
        accountsByTitle,
        tagsByTitle,
        tagsById
      );
      if (built.skip) {
        skipped.push({ id, reason: built.skip });
        continue;
      }
      const zen = built.zen!;
      applyDateComment(zen, edit);
      zen.changed = Math.floor(Date.now() / 1000);
      toPush.push({ id, zen });
      continue;
    }

    // ── Branch C: neither side is a transfer (expense ↔ income ↔ refund)
    // Single-leg, same-account flips: the money moves between the income
    // and outcome legs of the SAME account, or (income↔refund) stays put
    // and only the category flavour differs.
    const origLeg: "income" | "outcome" =
      orig.kind === "expense" ? "outcome" : "income";
    const targetLeg: "income" | "outcome" =
      targetKind === "expense" ? "outcome" : "income";
    if (targetKind !== orig.kind) {
      // FX guard: a NON-ZERO operational amount means the transaction's
      // currency differs from the account's (op-amount is the foreign
      // value). Note Zenmoney stores 0 (not null) for the unused leg of
      // a plain same-currency row, so we must test `> 0`, not non-null —
      // otherwise every ordinary expense (opOutcome: 0) would be skipped.
      if ((original.opIncome || 0) > 0 || (original.opOutcome || 0) > 0) {
        skipped.push({
          id,
          reason:
            "Операция в валюте, отличной от счёта (мультивалютная) — смену типа пока не поддерживаем.",
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

    // Account change (non-transfer rows). Runs last so the effective leg
    // instrument already reflects any kind-flip and currency edit above —
    // that keeps account+kind and account+currency combos correct. We only
    // support a move to an account in the SAME currency; cross-currency
    // would need op-amount (FX) handling, which is out of scope.
    if (edit.account !== undefined && edit.account !== orig.account) {
      const newAcc = accountsByTitle.get(edit.account);
      if (!newAcc) {
        skipped.push({ id, reason: `счёт "${edit.account}" не найден в Zenmoney` });
        continue;
      }
      const effInstr =
        targetLeg === "outcome" ? zen.outcomeInstrument : zen.incomeInstrument;
      if (newAcc.instrument !== effInstr) {
        skipped.push({
          id,
          reason:
            "смена счёта на счёт в другой валюте (мультивалюта) пока не поддерживается — отредактируйте в приложении",
        });
        continue;
      }
      // Non-transfer invariant: both legs point at the same account.
      zen.outcomeAccount = newAcc.id;
      zen.incomeAccount = newAcc.id;
    }

    // Server uses `changed` for last-write-wins conflict resolution.
    // Setting it to "now" ensures our edit wins over anything older on
    // the server. (Conflicts where the cloud changed since our last sync
    // are caught pre-push by detectConflicts; see useZenmoneyStore.)
    zen.changed = Math.floor(Date.now() / 1000);

    toPush.push({ id, zen });
  }

  return { toPush, skipped };
}

/**
 * Detect edits that would clobber a newer cloud version. Compares the
 * `changed` timestamp we last synced (in `cache`) against a FRESH cloud
 * diff fetched just before pushing. An edited id whose cloud `changed`
 * advanced since our sync is a conflict — pushing it would overwrite a
 * change made elsewhere (e.g. the phone app). Pure: callers fetch the
 * diff and apply it afterwards.
 *
 * @param editedIds ids of transactions with a pending local edit
 * @param cache     the PRE-merge cache (its `changed` = value at last sync)
 * @param fresh     transactions from a fresh `fetchDiff` since last sync
 * @returns set of ids that changed in the cloud since we synced
 */
export function detectConflicts(
  editedIds: string[],
  cache: ZenCache,
  fresh: ZenTransaction[]
): Set<string> {
  const cached = new Map(cache.transactions.map((t) => [t.id, t.changed ?? 0]));
  const freshChanged = new Map(fresh.map((t) => [t.id, t.changed ?? 0]));
  const out = new Set<string>();
  for (const id of editedIds) {
    const f = freshChanged.get(id);
    if (f !== undefined && f > (cached.get(id) ?? 0)) out.add(id);
  }
  return out;
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
