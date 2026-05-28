import { create } from "zustand";
import {
  loadSnapshotIndex,
  takeSnapshot as takeSnapshotImpl,
  deleteSnapshot as deleteSnapshotImpl,
  clearAllSnapshots as clearAllImpl,
  downloadSnapshot as downloadSnapshotImpl,
  importSnapshotFromJson as importSnapshotImpl,
  restoreSnapshotToCloud as restoreSnapshotImpl,
  type CloudSnapshotSummary,
  type RestoreResult,
  type RestoreProgress,
} from "../lib/cloudSnapshots";
import { loadZenCache } from "../lib/zenmoneyCache";
import { useZenmoneyStore } from "./useZenmoneyStore";

/**
 * Thin reactive wrapper over `lib/cloudSnapshots`. The UI consumes this
 * store; the actual IDB / network work lives in the lib module so it can
 * also be called from non-React code paths (e.g. the future auto-
 * snapshot hook that fires before any push-to-Zenmoney operation).
 *
 * Only summaries are kept in memory — the full raw blob per snapshot is
 * lazy-loaded on demand (download / restore-preview).
 */
interface State {
  snapshots: CloudSnapshotSummary[];
  loaded: boolean;
  /** Set while a network/IO operation is in flight — UI greys out the buttons. */
  busy: boolean;
  /** Last error message from `takeSnapshot` for inline display. Cleared on next call. */
  error: string | null;
  /** Last successful restore result (counts of accepted entities). */
  lastRestoreResult: RestoreResult | null;
  /** Live progress signal during an in-flight restore. UI consumes
   *  it to render a status bar like "Восстановление: Счета 5 / 31".
   *  Reset to null when restore finishes (success or failure). */
  restoreProgress: RestoreProgress | null;

  hydrate: () => Promise<void>;
  takeSnapshot: () => Promise<void>;
  deleteSnapshot: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  download: (id: string) => Promise<void>;
  /** Import a previously-downloaded snapshot file into the local
   *  IndexedDB. Validated; throws via `error` state on bad input. */
  importFromFile: (file: File) => Promise<void>;
  /** Push the snapshot's contents back to the cloud via `pushDiff`.
   *  Returns the per-entity acceptance counts. Caller is expected
   *  to surface a confirmation dialog before invoking — restore is
   *  potentially destructive (overwrites cloud state). */
  restore: (id: string) => Promise<RestoreResult>;
}

export const useCloudSnapshotStore = create<State>((set) => ({
  snapshots: [],
  loaded: false,
  busy: false,
  error: null,
  lastRestoreResult: null,
  restoreProgress: null,

  hydrate: async () => {
    const list = await loadSnapshotIndex();
    set({ snapshots: list, loaded: true });
  },

  takeSnapshot: async () => {
    // We deliberately read the token from the Zenmoney store at call
    // time (not via a hook) so this method works from non-React paths
    // too — e.g. the future "auto-snapshot before push" hook.
    const token = useZenmoneyStore.getState().token;
    if (!token) {
      set({ error: "Сначала подключите токен Дзен-мани API" });
      return;
    }
    set({ busy: true, error: null });
    try {
      await takeSnapshotImpl(token);
      const list = await loadSnapshotIndex();
      set({ snapshots: list, busy: false });
    } catch (e) {
      set({
        busy: false,
        error:
          e instanceof Error
            ? e.message
            : "Не удалось сделать снимок (см. консоль браузера)",
      });
    }
  },

  deleteSnapshot: async (id) => {
    set({ busy: true });
    try {
      await deleteSnapshotImpl(id);
      const list = await loadSnapshotIndex();
      set({ snapshots: list, busy: false });
    } catch {
      set({ busy: false });
    }
  },

  clearAll: async () => {
    set({ busy: true });
    try {
      await clearAllImpl();
      set({ snapshots: [], busy: false });
    } catch {
      set({ busy: false });
    }
  },

  download: async (id) => {
    await downloadSnapshotImpl(id);
  },

  importFromFile: async (file) => {
    set({ busy: true, error: null });
    try {
      const text = await file.text();
      await importSnapshotImpl(text);
      const list = await loadSnapshotIndex();
      set({ snapshots: list, busy: false });
    } catch (e) {
      set({
        busy: false,
        error:
          e instanceof Error
            ? e.message
            : "Не удалось импортировать снимок",
      });
    }
  },

  restore: async (id) => {
    const token = useZenmoneyStore.getState().token;
    if (!token) {
      const msg = "Сначала подключите токен Дзен-мани API";
      set({ error: msg });
      throw new Error(msg);
    }
    // Pull current user id + accounts from the local cache. The
    // restore impl uses these to (a) detect cross-account restores
    // and rewrite `user` fields accordingly, and (b) special-case
    // singular system accounts like the per-user debt account.
    const cache = await loadZenCache();
    const currentUserId = cache?.user?.[0]?.id ?? null;
    const currentAccounts = cache?.accounts ?? [];

    set({ busy: true, error: null, restoreProgress: null });
    try {
      const result = await restoreSnapshotImpl(
        id,
        token,
        { userId: currentUserId, currentAccounts },
        (progress) => set({ restoreProgress: progress })
      );
      set({ busy: false, lastRestoreResult: result, restoreProgress: null });
      return result;
    } catch (e) {
      set({
        busy: false,
        restoreProgress: null,
        error:
          e instanceof Error
            ? e.message
            : "Не удалось восстановить снимок (см. консоль)",
      });
      throw e;
    }
  },
}));
