/**
 * Cloud-snapshot infrastructure — Phase 0 of the two-way sync work.
 *
 * A "snapshot" is the raw, untransformed response of `POST /v8/diff/`
 * called with `serverTimestamp=0` (forced full sync). We store it byte-
 * for-byte the way Zenmoney returned it, so that:
 *
 *   • Worst-case recovery is trivial — push the same payload back via
 *     the same endpoint and Zenmoney accepts each entity as a normal
 *     sync update (last-write-wins by `changed` timestamp).
 *   • We never lose information by re-mapping into our local shape and
 *     back; the snapshot is auditable against what the cloud knows.
 *
 * Storage layout: each snapshot lives in its own IDB key
 * (`cloudSnapshot:<id>`) so we don't load 5 × 10MB blobs every time the
 * user opens Settings. A separate `cloudSnapshotIndex` key keeps a
 * lightweight summary list keyed by id, for cheap rendering.
 *
 * The store keeps the most recent N snapshots (default 5). Old ones
 * roll off automatically so IndexedDB doesn't bloat unboundedly.
 */

import * as db from "./db";
import type { ZenDiffResponse } from "./zenmoney";
import { fetchDiff } from "./zenmoney";

const INDEX_KEY = "cloudSnapshotIndex";
const SNAPSHOT_PREFIX = "cloudSnapshot:";
const MAX_KEPT = 5;

export interface CloudSnapshotSummary {
  /** Stable id — ISO timestamp of when the snapshot was taken. */
  id: string;
  /** Wall-clock ms timestamp the snapshot was taken (client-side). */
  createdAt: number;
  /** `serverTimestamp` from the diff response — what point in cloud time we captured. */
  serverTimestamp: number;
  /** Per-entity counts at snapshot time. */
  counts: {
    transactions: number;
    accounts: number;
    tags: number;
    merchants: number;
    instruments: number;
    companies: number;
    user: number;
  };
  /** Approximate JSON byte size of the raw snapshot (after stringify). */
  approxBytes: number;
}

/** Full snapshot payload — separated so listing the index is cheap. */
export interface CloudSnapshot extends CloudSnapshotSummary {
  raw: ZenDiffResponse;
}

function snapshotKey(id: string): string {
  return `${SNAPSHOT_PREFIX}${id}`;
}

export async function loadSnapshotIndex(): Promise<CloudSnapshotSummary[]> {
  const data = await db.loadJSON<CloudSnapshotSummary[]>(INDEX_KEY);
  if (!Array.isArray(data)) return [];
  // Newest first — list is consulted by UI for ordering already, but
  // we sort defensively to stay correct after corrupt manual edits.
  return [...data].sort((a, b) => b.createdAt - a.createdAt);
}

export async function loadSnapshot(id: string): Promise<CloudSnapshot | null> {
  return db.loadJSON<CloudSnapshot>(snapshotKey(id));
}

/**
 * Forced full-sync against Zenmoney and persist the raw response as a
 * new snapshot. Rolls older snapshots off when the cap is exceeded.
 *
 * Throws if the API call fails. Caller decides UX (toast / inline error).
 */
export async function takeSnapshot(token: string): Promise<CloudSnapshot> {
  if (!token) throw new Error("Нет токена Дзен-мани — снимок невозможен");
  // `serverTimestamp=0` → full payload regardless of any previous sync.
  const raw = await fetchDiff(token, 0);

  const now = Date.now();
  const id = new Date(now).toISOString();
  const approxBytes = roughByteSize(raw);
  const summary: CloudSnapshotSummary = {
    id,
    createdAt: now,
    serverTimestamp: raw.serverTimestamp,
    counts: {
      transactions: raw.transaction?.length ?? 0,
      accounts: raw.account?.length ?? 0,
      tags: raw.tag?.length ?? 0,
      merchants: raw.merchant?.length ?? 0,
      instruments: raw.instrument?.length ?? 0,
      companies: (raw.company as unknown[] | undefined)?.length ?? 0,
      user: raw.user?.length ?? 0,
    },
    approxBytes,
  };
  const full: CloudSnapshot = { ...summary, raw };

  await db.saveJSON(snapshotKey(id), full);

  // Update index — prepend new, drop tails past the cap.
  const prev = await loadSnapshotIndex();
  const next = [summary, ...prev.filter((s) => s.id !== id)].slice(0, MAX_KEPT);
  await db.saveJSON(INDEX_KEY, next);

  // Garbage-collect any snapshot blobs not referenced by the new index.
  const kept = new Set(next.map((s) => s.id));
  for (const old of prev) {
    if (!kept.has(old.id)) {
      await db.saveJSON(snapshotKey(old.id), null);
    }
  }

  return full;
}

export async function deleteSnapshot(id: string): Promise<void> {
  await db.saveJSON(snapshotKey(id), null);
  const idx = await loadSnapshotIndex();
  await db.saveJSON(
    INDEX_KEY,
    idx.filter((s) => s.id !== id)
  );
}

export async function clearAllSnapshots(): Promise<void> {
  const idx = await loadSnapshotIndex();
  for (const s of idx) {
    await db.saveJSON(snapshotKey(s.id), null);
  }
  await db.saveJSON(INDEX_KEY, []);
}

/**
 * Trigger a browser download of the snapshot as a JSON file. Format is
 * the literal `ZenDiffResponse` Zenmoney sent us, wrapped with our own
 * metadata header (so the user knows what to do with it).
 */
export async function downloadSnapshot(id: string): Promise<void> {
  const snap = await loadSnapshot(id);
  if (!snap) throw new Error("Снимок не найден в локальной базе");
  const payload = {
    _meta: {
      app: "DzenAnalytics",
      schema: "cloud-snapshot/v1",
      createdAt: snap.createdAt,
      createdAtISO: snap.id,
      serverTimestamp: snap.serverTimestamp,
      counts: snap.counts,
      note:
        "Это сырой ответ POST /v8/diff/ от Zenmoney на момент снимка. " +
        "Хранится как safety-net на случай неудачной push-операции из приложения.",
    },
    diff: snap.raw,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const fname = `dzenanalytics-cloud-snapshot-${snap.id.replace(/[:.]/g, "-")}.json`;
  a.download = fname;
  a.click();
  URL.revokeObjectURL(url);
}

/** Best-effort byte size estimate. Avoids the cost of a full stringify
 *  for very large blobs — JSON.stringify is the canonical way but it
 *  duplicates the data in memory. UTF-8 string length × 2 is the rough
 *  worst case for non-ASCII; we sample-stringify to get a real number. */
function roughByteSize(obj: unknown): number {
  try {
    return new Blob([JSON.stringify(obj)]).size;
  } catch {
    return 0;
  }
}
