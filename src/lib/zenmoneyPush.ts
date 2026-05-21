/**
 * Reverse mapper: local `Transaction` edit → Zenmoney `ZenTransaction`.
 *
 * Phase 1 MVP scope. We push only the "safe" edit fields where the
 * inverse mapping is unambiguous:
 *
 *   • date            (direct YYYY-MM-DD)
 *   • payee           (string|null)
 *   • comment         (string|null)
 *   • amount          (replaces the amount on the side that already has it)
 *   • currency        (replaces the instrument on the side that already has it)
 *   • category        (resolved to a single tag id by title)
 *   • subcategory     (resolved as a child tag where parent's title matches)
 *
 * The following are deliberately NOT supported yet (the edit stays in
 * the local overlay; user gets a clear "skipped" reason):
 *
 *   • kind change        — requires rewriting both legs of the tx
 *   • account change     — same; legs must stay consistent
 *   • outcomeAccount /
 *     incomeAccount      — used together with kind=transfer changes
 *
 * Strategy: take the ORIGINAL `ZenTransaction` straight from cache and
 * apply only the fields the user actually touched. This preserves all
 * Zenmoney-specific fields we don't model locally (qrCode, latitude,
 * opIncome/opOutcome for FX, etc.) so a round-trip can't accidentally
 * blank them out.
 */

import { pushDiff, type PushPayload } from "./zenmoney";
import type { ZenDiffResponse, ZenTag, ZenTransaction } from "./zenmoney";
import type { ZenCache } from "./zenmoneyCache";
import type { TransactionEdit } from "../store/useEditsStore";

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

  const toPush: PushItem[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const [id, edit] of Object.entries(edits)) {
    const original = transactionsById.get(id);
    if (!original) {
      skipped.push({
        id,
        reason:
          "оригинал не найден в локальном кэше API (нужен ре-синк перед push)",
      });
      continue;
    }
    if (original.deleted) {
      skipped.push({ id, reason: "транзакция помечена удалённой в облаке" });
      continue;
    }

    // Hard "no" for unsupported edit fields. Surface a precise reason so
    // the user understands why their edit didn't go out — and so they
    // can decide whether to roll the edit back or apply it manually in
    // the mobile app.
    if (edit.kind !== undefined) {
      skipped.push({
        id,
        reason:
          "Phase 1 не поддерживает смену типа операции (Расход/Доход/Перевод). Отредактируйте в мобильном приложении.",
      });
      continue;
    }
    if (
      edit.account !== undefined ||
      edit.outcomeAccount !== undefined ||
      edit.incomeAccount !== undefined
    ) {
      skipped.push({
        id,
        reason:
          "Phase 1 не поддерживает смену счёта операции. Отредактируйте в мобильном приложении.",
      });
      continue;
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

    // Amount goes on the side that already had non-zero (Zen's data
    // model has both legs; for income-only tx only `income` is > 0; for
    // expense-only only `outcome`). Transfer legs would each have their
    // own amount — we refused those above via the kind/account guard.
    if (edit.amount !== undefined) {
      if ((original.outcome || 0) > 0) zen.outcome = edit.amount;
      else if ((original.income || 0) > 0) zen.income = edit.amount;
    }

    if (edit.currency !== undefined) {
      const instr = instrumentsBySymbol.get(edit.currency);
      if (instr) {
        if ((original.outcome || 0) > 0) zen.outcomeInstrument = instr.id;
        else if ((original.income || 0) > 0) zen.incomeInstrument = instr.id;
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
  items: PushItem[]
): Promise<ZenDiffResponse> {
  const payload: PushPayload = {
    transaction: items.map((i) => i.zen),
  };
  return pushDiff(token, serverTimestamp, payload);
}
