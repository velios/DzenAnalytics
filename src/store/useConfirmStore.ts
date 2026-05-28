import { create } from "zustand";

/**
 * Imperative `confirm()` replacement built on a Zustand store.
 *
 * Instead of a `useConfirm()` hook + Provider boilerplate, this file
 * exposes a plain `confirm({ title, message, tone })` function that
 * returns a `Promise<boolean>`. The Promise resolves to `true` when
 * the user clicks Confirm, `false` on Cancel / Escape / backdrop
 * click. Callable from anywhere — React component, async handler,
 * non-React code path.
 *
 *   const ok = await confirm({
 *     title: "Отключить токен Дзен-мани?",
 *     message: "Данные останутся, но автосинк станет недоступен.",
 *     confirmLabel: "Отключить",
 *     tone: "danger",
 *   });
 *   if (!ok) return;
 *
 * One `<ConfirmDialog>` mounted at the root of the app subscribes to
 * the store and renders the modal when `isOpen` is true.
 */

export type ConfirmTone = "primary" | "danger" | "warning";

export interface ConfirmOptions {
  /** Bold one-liner at the top of the dialog. Optional. */
  title?: string;
  /** Body copy. Can include newlines — rendered as paragraphs. */
  message: string;
  /** Confirm-button label. Defaults to "Подтвердить". */
  confirmLabel?: string;
  /** Cancel-button label. Defaults to "Отмена". */
  cancelLabel?: string;
  /** Visual tone of the Confirm button. Defaults to "primary". */
  tone?: ConfirmTone;
}

interface ConfirmState {
  isOpen: boolean;
  options: ConfirmOptions | null;
  /** Internal — set by `confirm()`, called by close(). */
  _resolve: ((value: boolean) => void) | null;
  show: (opts: ConfirmOptions) => Promise<boolean>;
  close: (result: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  isOpen: false,
  options: null,
  _resolve: null,
  show: (opts) =>
    new Promise<boolean>((resolve) => {
      // If another dialog was somehow still in flight, dismiss it as
      // cancelled before opening the new one.
      const prev = get()._resolve;
      if (prev) prev(false);
      set({ isOpen: true, options: opts, _resolve: resolve });
    }),
  close: (result) => {
    const resolve = get()._resolve;
    set({ isOpen: false, options: null, _resolve: null });
    if (resolve) resolve(result);
  },
}));

/**
 * Convenience wrapper so callers can do `await confirm(opts)` without
 * importing the store directly. Mirrors the native `window.confirm`
 * signature shape but with a richer options object.
 */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().show(opts);
}
