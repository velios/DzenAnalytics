import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Plus, Save, X, TrendingUp, TrendingDown, ArrowLeftRight, Undo2, Trash2 } from "lucide-react";
import { extractHashtags } from "../lib/aggregations";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore } from "../store/useEditsStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import {
  getBrandTitlesFromCache,
  getLiveAccountsFromCache,
  useZenmoneyStore,
} from "../store/useZenmoneyStore";
import { confirm } from "../store/useConfirmStore";
import { loadZenCache } from "../lib/zenmoneyCache";
import {
  buildDraftTransaction,
  newDraftId,
  type DraftFields,
} from "../lib/zenmoneyPush";
import { Combobox, type ComboboxGroup } from "./Combobox";
import { CategoryCascadePicker, type CategoryNode } from "./CategoryCascadePicker";
import { DateField } from "./DateField";
import type { ZenTag } from "../lib/zenmoney";
import { HashtagTextarea } from "./HashtagTextarea";
import type { Transaction, TxKind } from "../types";

interface Props {
  /** The transaction to edit. Omit (or null) to open the modal in
   *  "create" mode — a brand-new draft operation. */
  tx?: Transaction | null;
  /** Pre-selected kind for a freshly created operation (create mode only).
   *  Defaults to "expense". Ignored when editing an existing `tx`. */
  initialKind?: TxKind;
  onClose: () => void;
}

/** Today's date as ISO YYYY-MM-DD, for seeding a new draft. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local "HH:MM" time-of-day from an ISO timestamp (the operation's `created`).
 *  Empty string when the timestamp is missing/invalid (e.g. some CSV rows). */
function isoToLocalTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Combine an accounting date (YYYY-MM-DD) + local "HH:MM" into a Date built in
 *  local time, so it round-trips with `isoToLocalTime`. */
function dateTimeToDate(dateIso: string, time: string): Date {
  const [y, mo, d] = dateIso.split("-").map(Number);
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  return new Date(y, (mo || 1) - 1, d || 1, m ? +m[1] : 0, m ? +m[2] : 0, 0, 0);
}

/**
 * Modal for editing a single transaction OR creating a new one.
 *
 * Edit mode (a `tx` is given): writes a patch to the local overlay
 * (`useEditsStore`); the cloud copy is touched only on the next push.
 *
 * Create mode (no `tx`): builds a fresh `ZenTransaction` from the form and
 * stores it as a draft (`useDraftsStore`) — it shows up in the list right
 * away and is sent to Zenmoney on the next push. API mode only (the caller
 * only offers the button when a token is present).
 */
export function EditTransactionModal({ tx: txProp, initialKind, onClose }: Props) {
  const isCreate = !txProp;
  const rates = useDataStore((s) => s.rates);
  // A blank seed so every `tx.<field>` read below works uniformly in
  // create mode (no special-casing each reference).
  const tx: Transaction = useMemo(
    () =>
      txProp ?? {
        id: "",
        date: todayIso(),
        category: "",
        subcategory: null,
        categoryFull: "",
        payee: "",
        brand: null,
        comment: "",
        outcomeAccount: "",
        outcomeAmount: 0,
        outcomeCurrency: rates.base,
        incomeAccount: "",
        incomeAmount: 0,
        incomeCurrency: rates.base,
        kind: initialKind ?? "expense",
        amount: 0,
        currency: rates.base,
        account: "",
        amountBase: 0,
        createdAt: `${todayIso()}T00:00:00Z`,
      },
    [txProp, rates.base, initialKind]
  );
  const allTransactions = useDataStore((s) => s.transactions);
  const reapply = useDataStore((s) => s.reapplyRules);
  const refresh = useDataStore((s) => s.refresh);
  const setEdit = useEditsStore((s) => s.setEdit);
  const addDraft = useDraftsStore((s) => s.add);
  // A not-yet-pushed draft: deleting discards it permanently (no cloud row, no
  // restore), so the confirm copy below is tailored for that case.
  const isDraftEdit = useDraftsStore((s) => !isCreate && Boolean(s.drafts[tx.id]));
  const deleteTransaction = useDataStore((s) => s.deleteTransaction);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    const pushMode = useZenmoneyStore.getState().pushMode;
    const ok = await confirm({
      title: isDraftEdit ? "Удалить черновик?" : "Удалить операцию?",
      message: isDraftEdit
        ? "Это несинхронизированный черновик — он будет удалён локально и не отправится в Дзен-мани. Действие необратимо."
        : pushMode !== "off"
          ? "Операция скроется из всех расчётов и списков. Так как включён Push, при следующей отправке она будет удалена и в облаке Дзен-мани. Вернуть можно на странице «Удалённые» — в т.ч. в облако."
          : "Операция скроется из всех расчётов и списков. Вернуть можно на странице «Удалённые». В облаке Дзен-мани она не тронется.",
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (!ok) return;
    await deleteTransaction(tx.id);
    onClose();
  }

  const [kind, setKind] = useState<TxKind>(tx.kind);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const metaLoaded = useCategoryMetaStore((s) => s.loaded);
  const hydrateMeta = useCategoryMetaStore((s) => s.hydrate);
  useEffect(() => {
    if (!metaLoaded) hydrateMeta();
  }, [metaLoaded, hydrateMeta]);

  // Build the category list shown to the user. Priority:
  //   1. If Zenmoney `categoryMeta` is populated (API mode), filter by the
  //      tag's declared `showIncome` / `showOutcome` flags — that's the
  //      canonical "which categories belong to this side" answer.
  //   2. Otherwise (CSV mode, no meta), fall back to the heuristic that
  //      inspects observed transactions of the matching kind.
  // Subcategories always come from observed data — Zenmoney's tag hierarchy
  // isn't fully exposed here, so the heuristic is the best we can do.
  const { categoryOptions, subcatByCategory } = useMemo(() => {
    const subByCat = new Map<string, Set<string>>();
    for (const t of allTransactions) {
      if (!t.category || !t.subcategory) continue;
      let bucket = subByCat.get(t.category);
      if (!bucket) {
        bucket = new Set<string>();
        subByCat.set(t.category, bucket);
      }
      bucket.add(t.subcategory);
    }

    // 1) API-flagged categories first.
    const metaKeys = Object.keys(categoryMeta);
    const hasFlags = metaKeys.some(
      (k) =>
        categoryMeta[k]?.showIncome !== undefined ||
        categoryMeta[k]?.showOutcome !== undefined
    );
    if (hasFlags && kind !== "transfer") {
      const flagField = kind === "income" ? "showIncome" : "showOutcome";
      const cats = metaKeys.filter((name) => categoryMeta[name]?.[flagField]);
      return {
        categoryOptions: cats.sort((a, b) => a.localeCompare(b, "ru")),
        subcatByCategory: subByCat,
      };
    }

    // 2) Fallback — derive from observed transactions of this kind.
    const cats = new Set<string>();
    for (const t of allTransactions) {
      if (kind !== "transfer" && t.kind !== kind) continue;
      if (!t.category) continue;
      cats.add(t.category);
    }
    return {
      categoryOptions: Array.from(cats).sort((a, b) => a.localeCompare(b, "ru")),
      subcatByCategory: subByCat,
    };
  }, [allTransactions, kind, categoryMeta]);

  // Raw Zenmoney tags — the only place the real parent→child hierarchy lives
  // (categoryMeta is keyed by title and flattens it, which is why sub-tags
  // currently leak into the first level). Loaded once for the cascade picker.
  const [cacheTags, setCacheTags] = useState<ZenTag[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadZenCache().then((c) => {
      if (!cancelled) setCacheTags(c?.tags ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Top-level categories (this kind only) each with their sub-categories, for
  // the single cascade field. Hierarchy comes from the raw tags (authoritative)
  // unioned with sub-categories observed in the data; child tags that leaked
  // into `categoryOptions` are dropped from the first level.
  const categoryNodes = useMemo<CategoryNode[]>(() => {
    const subsMap = new Map<string, Set<string>>();
    const addSub = (cat: string, sub: string) => {
      let s = subsMap.get(cat);
      if (!s) {
        s = new Set<string>();
        subsMap.set(cat, s);
      }
      s.add(sub);
    };
    for (const [cat, subs] of subcatByCategory)
      for (const sub of subs) addSub(cat, sub);
    const realTop = new Set<string>();
    if (cacheTags) {
      const byId = new Map(cacheTags.map((t) => [t.id, t] as const));
      for (const t of cacheTags) {
        if (t.archive) continue;
        if (t.parent) {
          const parent = byId.get(t.parent);
          if (parent) addSub(parent.title, t.title);
        } else {
          realTop.add(t.title);
        }
      }
    }
    // Names that are a child of some category — drop them from the first level
    // unless they're *also* a genuine top-level tag (e.g. a "Прочее" that exists
    // both as its own category and as a sub elsewhere).
    const childNames = new Set<string>();
    for (const subs of subsMap.values()) for (const s of subs) childNames.add(s);
    const tops = categoryOptions.filter(
      // Drop full-path «Parent / Sub» entries — categoryMeta carries those keys
      // (for same-named-sub icons), but the first level is top-level only; subs
      // are reached via the right panel.
      (c) => !c.includes(" / ") && (realTop.has(c) || !childNames.has(c))
    );
    return tops.map((name) => ({
      name,
      subs: Array.from(subsMap.get(name) ?? []).sort((a, b) =>
        a.localeCompare(b, "ru")
      ),
    }));
  }, [categoryOptions, subcatByCategory, cacheTags]);

  // "Получатель" suggestions, served as two distinct groups so the
  // user can tell at a glance which bucket a suggestion comes from:
  //   1) "Получатели Дзен-мани" — everything that's been through
  //      Zenmoney's merchant dictionary. Includes both global-catalog
  //      brands (Wildberries, Магнит) AND user-created entries
  //      ("Сосед Сёма"). The API gives no flag to distinguish the two,
  //      so we don't try. The label says "получатели", not "бренды",
  //      to avoid implying the list is the global brand catalog only.
  //   2) "Из выписок банка" — raw payee strings that *don't* have a
  //      merchant assigned. The bank's printout as-is, never touched
  //      by Zenmoney's normalization.
  const [cachedBrands, setCachedBrands] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    getBrandTitlesFromCache().then((list) => {
      if (!cancelled) setCachedBrands(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // Account → native currency, from the live Zenmoney cache. Lets us detect
  // a cross-currency transfer (legs in different currencies) and ask for the
  // second amount. Null in CSV mode → we never show the second field there.
  const [accountCurrency, setAccountCurrency] = useState<Map<string, string>>(
    new Map()
  );
  const [defaultAccount, setDefaultAccount] = useState<string | null>(null);
  const [archivedAccounts, setArchivedAccounts] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    getLiveAccountsFromCache().then((list) => {
      if (cancelled || !list) return;
      setAccountCurrency(new Map(list.map((a) => [a.title, a.currency])));
      setArchivedAccounts(new Set(list.filter((a) => a.archive).map((a) => a.title)));
      // Remember the first non-archived account so create mode can seed
      // the account fields (applied in a dedicated effect below).
      const firstActive = list.find((a) => !a.archive) ?? list[0];
      if (firstActive) setDefaultAccount(firstActive.title);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const payeeGroups = useMemo(() => {
    const brandSet = new Set<string>();
    if (cachedBrands) for (const b of cachedBrands) brandSet.add(b);
    for (const t of allTransactions) {
      const b = t.brand?.trim();
      if (b) brandSet.add(b);
    }
    const payeeSet = new Set<string>();
    for (const t of allTransactions) {
      const p = t.payee?.trim();
      if (p && !brandSet.has(p)) payeeSet.add(p);
    }
    const cmp = (a: string, b: string) => a.localeCompare(b, "ru");
    const groups = [];
    if (brandSet.size > 0) {
      groups.push({
        label: "Получатели Дзен-мани",
        items: Array.from(brandSet).sort(cmp),
      });
    }
    if (payeeSet.size > 0) {
      groups.push({
        label: "Из выписок банка",
        items: Array.from(payeeSet).sort(cmp),
      });
    }
    return groups;
  }, [cachedBrands, allTransactions]);
  // Flat fallback — used by Combobox only when `groups` is empty
  // (rare: no cache and no transactions yet).
  const payeeOptions = useMemo(
    () => payeeGroups.flatMap((g) => g.items),
    [payeeGroups]
  );

  // All account names ever used in the dataset (debit / cash / credit /
  // debt — anything that's appeared either as `account`, `outcomeAccount`
  // or `incomeAccount`), PLUS every live account from the Zenmoney cache.
  // The cache matters for create mode: a freshly-opened account with no
  // transactions yet still needs to be pickable. Sorted alphabetically.
  const accountOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTransactions) {
      if (t.account) set.add(t.account);
      if (t.outcomeAccount) set.add(t.outcomeAccount);
      if (t.incomeAccount) set.add(t.incomeAccount);
    }
    for (const title of accountCurrency.keys()) set.add(title);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [allTransactions, accountCurrency]);

  // Grouped account list for the pickers: «Часто используемые» (top-10 by how
  // many transactions touch the account), then «Активные» / «Архивные» (archive
  // flag from the Zenmoney cache). Falls back to the flat list for short lists.
  const accountGroups = useMemo<ComboboxGroup[]>(() => {
    const counts = new Map<string, number>();
    for (const t of allTransactions) {
      const accs = new Set(
        [t.account, t.outcomeAccount, t.incomeAccount].filter(Boolean)
      );
      for (const a of accs) counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    const top = [...counts.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name);
    const groups: ComboboxGroup[] = [];
    // Only worth a separate «frequent» shortcut when the full list is long;
    // its accounts are then excluded from «Активные»/«Архивные» so nothing
    // is shown twice.
    const showTop = accountOptions.length > 10 && top.length > 0;
    const topSet = showTop ? new Set(top) : new Set<string>();
    if (showTop) groups.push({ label: "Часто используемые", items: top });
    const active = accountOptions.filter((a) => !archivedAccounts.has(a) && !topSet.has(a));
    const archived = accountOptions.filter((a) => archivedAccounts.has(a) && !topSet.has(a));
    if (active.length) groups.push({ label: "Активные", items: active });
    if (archived.length) groups.push({ label: "Архивные", items: archived });
    return groups;
  }, [allTransactions, accountOptions, archivedAccounts]);

  const [date, setDate] = useState(tx.date);
  // Operation time-of-day. New draft → seed with the current local time;
  // edit → the original `created` time. Persisted via the `createdAt` patch.
  const [time, setTime] = useState(() =>
    isCreate ? isoToLocalTime(new Date().toISOString()) : isoToLocalTime(tx.createdAt)
  );
  const [category, setCategory] = useState(tx.category);
  const [subcategory, setSubcategory] = useState(tx.subcategory ?? "");
  // Single "Получатель" field — saves into `brand`, which is the
  // displayed counterparty name. Falls back to `tx.payee` for
  // transactions that don't have a brand attached yet (CSV imports,
  // unbranded operations). The raw bank-statement text (`tx.payee`)
  // is left untouched in the data — it stays as the source of truth
  // for what the bank actually printed.
  const [payee, setPayee] = useState(tx.brand?.trim() || tx.payee || "");
  const [comment, setComment] = useState(tx.comment);

  // Tags already used across the account — fed to the comment field's «#»
  // autocomplete (see HashtagTextarea).
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTransactions)
      for (const h of extractHashtags(t.comment)) set.add(h);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [allTransactions]);
  // Blank amount in create mode (don't prefill "0"); the existing value
  // otherwise.
  const [amount, setAmount] = useState(isCreate ? "" : String(tx.amount));
  const [currency, setCurrency] = useState(tx.currency);
  const [account, setAccount] = useState(tx.account);
  // Transfer-specific: outcome / income accounts. For income/expense we
  // hide these and rely on the single `account` field above.
  const [outAcc, setOutAcc] = useState(tx.outcomeAccount || tx.account);
  const [inAcc, setInAcc] = useState(tx.incomeAccount || "");
  // Destination-leg amount, only used for a cross-currency transfer.
  const [inAmount, setInAmount] = useState(
    tx.incomeAmount ? String(tx.incomeAmount) : ""
  );

  // Create mode: once the live accounts are known, seed the (still-blank)
  // account fields with the first active account so the form is usable
  // out of the box. Never stomps a user pick.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isCreate || !defaultAccount) return;
    setAccount((a) => a || defaultAccount);
    setOutAcc((a) => a || defaultAccount);
  }, [isCreate, defaultAccount]);
  // Create mode, single-leg: a new operation's amount is in the source
  // account's own currency (the draft builder resolves the instrument from
  // the account, not the picker). Keep the currency field truthful by
  // following the selected account; the picker is disabled in this mode.
  useEffect(() => {
    if (!isCreate || kind === "transfer") return;
    const cur = accountCurrency.get(account.trim());
    if (cur) setCurrency((c) => (c === cur ? c : cur));
  }, [isCreate, kind, account, accountCurrency]);
  /* eslint-enable react-hooks/set-state-in-effect */
  // Did the user hand-edit the received amount? While false we keep it in sync
  // with the FX rate; once they type, we stop overwriting (they exchanged at
  // their own rate). The «↻ по курсу» link flips it back to auto.
  const [manualIn, setManualIn] = useState(false);
  const [saving, setSaving] = useState(false);

  // Cross-currency transfer: both accounts known and in different currencies.
  // Only then do we need (and show) a separate destination amount/currency.
  const inAccCurrency = accountCurrency.get(inAcc.trim());
  const isCrossCurrencyTransfer =
    kind === "transfer" &&
    !!accountCurrency.get(outAcc.trim()) &&
    !!inAccCurrency &&
    accountCurrency.get(outAcc.trim()) !== inAccCurrency;

  // Auto-convert the received amount using the rates that came with the last
  // sync (rates.rates[cur] = units of `cur` per 1 base). sent·r_src/r_dst.
  const sentNum = Number(amount.replace(",", "."));
  const rSrc = rates.rates[currency.trim()];
  const rDst = inAccCurrency ? rates.rates[inAccCurrency] : undefined;
  const suggestedIn =
    isCrossCurrencyTransfer && Number.isFinite(sentNum) && rSrc && rDst
      ? Math.round((sentNum * rSrc) / rDst * 100) / 100
      : null;
  // What the «Получено» field shows / saves: the user's manual value, else the
  // live FX suggestion.
  const inAmountValue =
    manualIn || suggestedIn === null ? inAmount : String(suggestedIn);

  // Preserve an existing cross-currency received amount on open: mark it manual
  // once account currencies have loaded, so re-saving (e.g. just a comment)
  // never silently overwrites the user's real exchanged sum. Runs once.
  const inInitRef = useRef(false);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (inInitRef.current || accountCurrency.size === 0) return;
    inInitRef.current = true;
    const oc = accountCurrency.get((tx.outcomeAccount || tx.account).trim());
    const ic = accountCurrency.get((tx.incomeAccount || "").trim());
    if (tx.kind === "transfer" && tx.incomeAmount > 0 && oc && ic && oc !== ic) {
      setManualIn(true);
    }
  }, [accountCurrency, tx]);
  /* eslint-enable react-hooks/set-state-in-effect */
  // Non-transfer moved onto an account whose native currency differs from the
  // operation currency → it becomes an FX row on push. Hint the user that the
  // amount should be in the new account's currency.
  const accountNativeCurrency =
    kind !== "transfer" ? accountCurrency.get(account.trim()) : undefined;
  const isCrossCurrencyMove =
    !!accountNativeCurrency && accountNativeCurrency !== currency;

  // Tracks whether the most recent mousedown landed on the backdrop. Used
  // by the click handler to decide whether to close — drags that started
  // inside the modal but happened to release on the backdrop must NOT
  // count as a backdrop click.
  const backdropMouseDownRef = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Create mode: build a fresh ZenTransaction from the form and store it as
  // a draft. Validation/resolution lives in `buildDraftTransaction` (pure,
  // unit-tested); we surface its skip reason inline on failure.
  async function saveDraft() {
    const cache = await loadZenCache();
    if (!cache) {
      setError("Создание операций доступно только при синхронизации с Zenmoney.");
      return;
    }
    const fields: DraftFields = {
      id: newDraftId(),
      kind,
      date,
      createdSeconds: /^\d{2}:\d{2}$/.test(time)
        ? Math.floor(dateTimeToDate(date, time).getTime() / 1000)
        : undefined,
      amount: Number(amount.replace(",", ".")),
      account: kind === "transfer" ? outAcc.trim() : account.trim(),
      incomeAccount: kind === "transfer" ? inAcc.trim() : undefined,
      incomeAmount:
        kind === "transfer" && isCrossCurrencyTransfer
          ? Number(inAmountValue.replace(",", "."))
          : undefined,
      category: kind === "transfer" ? undefined : category.trim(),
      subcategory: kind === "transfer" ? null : subcategory.trim() || null,
      payee: kind === "transfer" ? undefined : payee.trim(),
      comment: comment.trim(),
    };
    const built = buildDraftTransaction(
      fields,
      cache,
      Math.floor(Date.now() / 1000)
    );
    if (!built.zen) {
      setError(built.skip ?? "Не удалось создать операцию");
      return;
    }
    await addDraft(built.zen);
    await refresh();
    onClose();
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (isCreate) {
        await saveDraft();
        return;
      }
      const amtNum = Number(amount.replace(",", "."));
      const safeAmount =
        Number.isFinite(amtNum) && amtNum >= 0 ? amtNum : tx.amount;
      const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : tx.date;

      // Build a MINIMAL patch — only fields whose new value actually
      // differs from the original transaction. This matters for the
      // push pipeline: `buildPushItems` checks `edit.<field> !== undefined`
      // to decide whether the user touched a field, so stashing every
      // value here (even unchanged ones) would make a payee-only edit
      // look like a type-or-account change and get rejected by Phase 1
      // validation.
      const patch: Record<string, unknown> = {};

      // Helpers: trim both sides before comparing so a whitespace-only
      // delta still registers as "no change", but a real edit always
      // lands in the patch. Treating null/undefined as "" makes the
      // comparison total.
      const norm = (v: string | null | undefined) => (v ?? "").trim();
      const changed = (next: string, before: string | null | undefined) =>
        norm(next) !== norm(before);

      if (safeDate !== tx.date) patch.date = safeDate;

      // Time-of-day lives in `created`/`createdAt`. Only patch it when the user
      // actually changed the time — otherwise a no-op save (or a date-only
      // edit) would needlessly rewrite the original timestamp. The created date
      // follows the accounting date so what you see (Дата + Время) is stored.
      if (/^\d{2}:\d{2}$/.test(time) && time !== isoToLocalTime(tx.createdAt)) {
        patch.createdAt = dateTimeToDate(safeDate, time).toISOString();
      }

      const nextCategory = category.trim() || tx.category;
      if (changed(nextCategory, tx.category)) patch.category = nextCategory;

      const nextSubRaw = subcategory.trim();
      const nextSub = nextSubRaw || null;
      if (changed(nextSubRaw, tx.subcategory ?? "")) patch.subcategory = nextSub;

      // Brand — single "Получатель" UI field maps to the brand field
      // on the data model. Empty → null so display falls back to raw
      // payee. The raw `payee` (bank-statement text) is preserved
      // untouched as historical source-of-truth and never written here.
      const nextBrand = payee.trim() || null;
      if (norm(payee) !== norm(tx.brand ?? "")) patch.brand = nextBrand;

      const nextComment = comment.trim();
      if (changed(nextComment, tx.comment)) patch.comment = nextComment;

      if (safeAmount !== tx.amount) patch.amount = safeAmount;

      const nextCurrency = currency.trim() || tx.currency;
      if (changed(nextCurrency, tx.currency)) patch.currency = nextCurrency;

      if (kind !== tx.kind) patch.kind = kind;

      if (kind === "transfer") {
        // For transfers we need both legs in sync. Whether or not the
        // user actually changed any account, write all three so the
        // pipeline never sees half-stale data. The push transformer
        // will compare against the original to decide if it's a real
        // change worth refusing.
        const src = outAcc.trim() || tx.outcomeAccount || tx.account;
        const dst = inAcc.trim() || tx.incomeAccount || "";
        const accountsChanged =
          changed(src, tx.outcomeAccount) ||
          changed(dst, tx.incomeAccount) ||
          changed(src, tx.account);
        if (accountsChanged) {
          patch.outcomeAccount = src;
          patch.incomeAccount = dst;
          patch.account = src; // mapper convention: transfer rows live under source
        }
        // Cross-currency: carry the destination amount (in the destination
        // account's currency) so the push can build the second leg. Only
        // when it actually changed, or the row just became a transfer / its
        // accounts moved — a no-op edit must stay a no-op.
        if (isCrossCurrencyTransfer) {
          const inNum = Number(inAmountValue.replace(",", "."));
          const safeIn =
            Number.isFinite(inNum) && inNum > 0 ? inNum : tx.incomeAmount;
          if (
            safeIn !== tx.incomeAmount ||
            kind !== tx.kind ||
            accountsChanged
          ) {
            patch.incomeAmount = safeIn;
            patch.incomeCurrency = inAccCurrency;
          }
        }
      } else {
        const nextAccount = account.trim() || tx.account;
        if (changed(nextAccount, tx.account)) {
          patch.account = nextAccount;
          // Refund is an income-side flow too — the merchant returned
          // money TO the account — so the same convention as `income`
          // applies for which leg gets the account id.
          if (kind === "income" || kind === "refund") {
            patch.incomeAccount = nextAccount;
            patch.outcomeAccount = "";
          } else {
            patch.outcomeAccount = nextAccount;
            patch.incomeAccount = "";
          }
        }
      }

      // Nothing changed — bail without writing an empty overlay entry.
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }

      await setEdit(tx.id, patch);
      await reapply();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const currencyOptions = Array.from(
    new Set([currency, ...Object.keys(rates.rates)])
  );

  // Tight dropdown ceiling for these comboboxes. The default `min(50vh,
  // 320px)` is too generous when several comboboxes share a single modal
  // — opening one would push the controls below offscreen on smaller
  // viewports. 240px ≈ 8 visible rows, plenty for browsing.
  const DROPDOWN_MAX = "min(38vh, 240px)";

  // Portal to <body> so the overlay isn't a child of the page tree.
  // Rendered inline it inherited a `margin-top: 24px` from the parent's
  // `space-y-6` utility (it's a sibling row), which on a `fixed top:0`
  // element pushed the scrim down 24px — leaving an uncovered strip at
  // the top. A body-level portal also matches the standard modal pattern
  // (immune to ancestor transforms / containing blocks).
  return createPortal(
    <div
      // Plain dim scrim — NO backdrop-filter. A full-viewport
      // `backdrop-blur` over the chart-heavy page makes Chromium snapshot
      // the page to blur it, which intermittently flashes the root
      // (white) background for a frame on open. A solid dim never does.
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      // Only treat as "click on backdrop" when both press AND release
      // happened on the backdrop itself. Otherwise a mousedown inside
      // the modal (e.g. text-selecting through to whitespace, or
      // dragging the cursor a bit while typing) that ends outside the
      // modal would close it — really annoying.
      onMouseDown={(e) => {
        backdropMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropMouseDownRef.current) {
          onClose();
        }
        backdropMouseDownRef.current = false;
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-lg max-h-[90vh] overflow-y-auto"
        // Reserve the scrollbar's space at all times so toggling a field
        // (e.g. the cross-currency «Получено» row appearing when you pick a
        // foreign-currency account) doesn't change the content width and make
        // the whole modal shift/jump sideways.
        style={{ scrollbarGutter: "stable" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="font-semibold flex items-center gap-2">
            {isCreate ? (
              <Plus className="w-4 h-4 text-accent2" />
            ) : (
              <Pencil className="w-4 h-4 text-accent2" />
            )}
            {isCreate ? "Новая операция" : "Редактирование операции"}
          </div>
          <button onClick={onClose} className="text-muted hover:text-text">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {/* Kind switcher — 4-way pill toggle. "Возврат" is a money-back
              flow on an expense category; it inflows the account but
              shrinks the category's spend rather than adding to income. */}
          <Field label="Тип операции">
            <div className="inline-flex bg-panel2 border border-border rounded-lg p-0.5 w-full">
              <KindButton
                active={kind === "expense"}
                onClick={() => setKind("expense")}
                icon={TrendingDown}
                label="Расход"
                tone="expense"
              />
              <KindButton
                active={kind === "income"}
                onClick={() => setKind("income")}
                icon={TrendingUp}
                label="Доход"
                tone="income"
              />
              <KindButton
                active={kind === "refund"}
                onClick={() => setKind("refund")}
                icon={Undo2}
                label="Возврат"
                tone="accent2"
              />
              <KindButton
                active={kind === "transfer"}
                onClick={() => setKind("transfer")}
                icon={ArrowLeftRight}
                label="Перевод"
                tone="warn"
              />
            </div>
          </Field>
          {/* Date needs room for «дд.мм.гггг» + the calendar icon; time only
              holds «чч:мм», so give the date the wider column. */}
          <div className="grid grid-cols-[3fr_2fr] gap-3">
            <Field label="Дата">
              <DateField
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input text-sm w-full"
              />
            </Field>
            <Field label="Время">
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="input text-sm w-full"
              />
            </Field>
          </div>
          {/* Category / Subcategory — not shown for transfers: a transfer is
              just money moving between the user's own accounts, it has no
              spending/income category. */}
          {kind !== "transfer" && (
            // Single full-width field: top level lists only real categories;
            // a category's sub-categories open to the right (issue #12).
            <Field label="Категория">
              <CategoryCascadePicker
                category={category}
                subcategory={subcategory}
                categories={categoryNodes}
                onChange={(cat, sub) => {
                  setCategory(cat);
                  setSubcategory(sub);
                }}
              />
            </Field>
          )}
          {/* Account(s): one field for income/expense, two for transfer.
              Placed right under category — it's the second-most
              identifying attribute of a transaction after the category. */}
          {kind === "transfer" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Со счёта">
                <Combobox
                  value={outAcc}
                  options={accountOptions}
                  groups={accountGroups}
                  onChange={setOutAcc}
                  placeholder="Источник"
                  maxHeight={DROPDOWN_MAX}
                />
              </Field>
              <Field label="На счёт">
                <Combobox
                  value={inAcc}
                  options={accountOptions}
                  groups={accountGroups}
                  onChange={setInAcc}
                  placeholder="Получатель"
                  maxHeight={DROPDOWN_MAX}
                />
              </Field>
            </div>
          ) : (
            <Field label="Счёт">
              <Combobox
                value={account}
                options={accountOptions}
                groups={accountGroups}
                onChange={setAccount}
                placeholder="Введите или выберите из списка"
                maxHeight={DROPDOWN_MAX}
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={kind === "transfer" ? "Отправлено" : "Сумма"}>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="input text-sm w-full font-mono tabular-nums"
              />
            </Field>
            <Field label="Валюта">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                // Create + single-leg: currency follows the account (the
                // draft's amount is in the account's own currency).
                disabled={isCreate && kind !== "transfer"}
                className="input text-sm w-full disabled:opacity-60"
              >
                {currencyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {/* Cross-currency transfer: the destination leg holds a different
              sum in its own currency. Pre-filled from the synced FX rate, but
              the user can override it (they may have exchanged at another rate). */}
          {isCrossCurrencyTransfer && (
            <Field label={`Получено (${inAccCurrency})`}>
              <input
                value={inAmountValue}
                onChange={(e) => {
                  setInAmount(e.target.value);
                  setManualIn(true);
                }}
                inputMode="decimal"
                placeholder={`Сколько пришло на счёт в ${inAccCurrency}`}
                className="input text-sm w-full font-mono tabular-nums"
              />
              <div className="text-[10px] text-muted mt-1 flex items-center gap-2 flex-wrap">
                {manualIn ? (
                  <span>Сумма указана вручную.</span>
                ) : (
                  <span>Пересчитано по курсу синхронизации — можно поправить.</span>
                )}
                {manualIn && suggestedIn !== null && (
                  <button
                    type="button"
                    onClick={() => setManualIn(false)}
                    className="text-accent hover:underline"
                    title={`По курсу: ≈ ${suggestedIn.toLocaleString("ru-RU")} ${inAccCurrency}`}
                  >
                    ↻ пересчитать по курсу
                  </button>
                )}
              </div>
            </Field>
          )}
          {!isCreate && isCrossCurrencyMove && (
            <p className="text-xs text-muted -mt-1">
              Счёт в {accountNativeCurrency}: укажите «Сумму» в{" "}
              {accountNativeCurrency}. Исходная сумма ({tx.amount} {currency})
              сохранится как операционная (мультивалютная операция).
            </p>
          )}
          {/* Single "Получатель" field — autocompletes from the
              Zenmoney merchant dictionary plus historical raw-payee
              strings. Hidden for transfers (counterparty there is the
              income account, surfaced above in its own field). */}
          {kind !== "transfer" && (
            <Field label="Получатель">
              <Combobox
                value={payee}
                options={payeeOptions}
                groups={payeeGroups}
                onChange={setPayee}
                placeholder="Введите или выберите из списка"
                maxHeight={DROPDOWN_MAX}
              />
              {/* Tells the user how the current value will be pushed.
                  Matching the dictionary by case-insensitive equality
                  mirrors the lookup in zenmoneyPush.ts so the hint
                  doesn't lie about what actually happens. */}
              <PayeeKindHint value={payee} cachedBrands={cachedBrands} />
              {tx.payeeRaw && tx.payeeRaw !== payee && (
                // Honest "as printed by the bank" hint — uses the
                // immutable `payeeRaw` (originalPayee from the API),
                // not the possibly-edited `payee`. Helps the user
                // figure out where a weird counterparty name came
                // from. Hidden when raw equals current value.
                <div
                  className="text-[10px] text-muted/80 mt-1 pl-0 truncate"
                  title={tx.payeeRaw}
                >
                  В выписке: {tx.payeeRaw}
                </div>
              )}
            </Field>
          )}
          <Field label="Комментарий">
            <HashtagTextarea
              value={comment}
              onChange={setComment}
              tags={allTags}
              rows={1}
              // Single row by default; user can drag taller. min-h
              // matches one line + the input's vertical padding so it
              // can never shrink below a single readable row.
              className="input text-sm w-full resize-y min-h-[2.5rem]"
            />
          </Field>
        </div>
        {error && (
          <div className="px-5 -mt-1 pb-1 text-xs text-expense">{error}</div>
        )}
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border">
          {isCreate ? (
            <span />
          ) : (
            <button
              onClick={handleDelete}
              disabled={saving}
              className="btn-danger text-sm"
              title="Удалить операцию"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Удалить
            </button>
          )}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-ghost text-sm">
              Отмена
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="btn-primary text-sm"
            >
              {isCreate ? (
                <Plus className="w-3.5 h-3.5" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {isCreate ? "Создать" : "Сохранить"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label block mb-1">{label}</label>
      {children}
    </div>
  );
}

/**
 * Tiny indicator below the "Получатель" combobox. Tells the user
 * whether the currently-entered value will be pushed as a known
 * brand (merchant dictionary entry) or as free-text payee.
 *
 * Empty / whitespace-only input → render nothing (no noise on a
 * blank field). The dictionary lookup is case-insensitive to match
 * the equivalent lookup in `zenmoneyPush.ts`.
 */
function PayeeKindHint({
  value,
  cachedBrands,
}: {
  value: string;
  cachedBrands: string[] | null;
}) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // While the merchant dictionary is still being hydrated from cache
  // we don't know yet — stay silent rather than mislead.
  if (cachedBrands === null) return null;
  const lower = trimmed.toLowerCase();
  const matches = cachedBrands.some((b) => b.toLowerCase() === lower);
  if (matches) {
    return (
      <div className="text-[10px] text-income/90 mt-1 pl-0">
        Бренд из списка Дзен-мани ✓
      </div>
    );
  }
  return (
    <div className="text-[10px] text-muted mt-1 pl-0">
      Получатель не из списка Брендов ✗
    </div>
  );
}

function KindButton({
  active,
  onClick,
  icon: Icon,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone: "income" | "expense" | "warn" | "accent2";
}) {
  const activeBg =
    tone === "income"
      ? "bg-income text-white"
      : tone === "expense"
        ? "bg-expense text-white"
        : tone === "accent2"
          ? "bg-accent2 text-white"
          : "bg-warn text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active ? activeBg : "text-muted hover:text-text"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
