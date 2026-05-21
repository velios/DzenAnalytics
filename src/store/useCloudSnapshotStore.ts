import { create } from "zustand";
import {
  loadSnapshotIndex,
  takeSnapshot as takeSnapshotImpl,
  deleteSnapshot as deleteSnapshotImpl,
  clearAllSnapshots as clearAllImpl,
  downloadSnapshot as downloadSnapshotImpl,
  type CloudSnapshotSummary,
} from "../lib/cloudSnapshots";
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

  hydrate: () => Promise<void>;
  takeSnapshot: () => Promise<void>;
  deleteSnapshot: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  download: (id: string) => Promise<void>;
}

export const useCloudSnapshotStore = create<State>((set) => ({
  snapshots: [],
  loaded: false,
  busy: false,
  error: null,

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
}));
