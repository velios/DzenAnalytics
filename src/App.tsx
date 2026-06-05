import { useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { TopNav } from "./components/TopNav";
import { TransactionsDrawer } from "./components/TransactionsDrawer";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { DashboardPage } from "./pages/DashboardPage";
import { CashflowPage } from "./pages/CashflowPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { AccountsPage } from "./pages/AccountsPage";
import { TopPage } from "./pages/TopPage";
import { ComparePage } from "./pages/ComparePage";
import { ImportPage } from "./pages/ImportPage";
import { CalendarPage } from "./pages/CalendarPage";
import { TagsPage } from "./pages/TagsPage";
import { RecurringPage } from "./pages/RecurringPage";
import { TrendsPage } from "./pages/TrendsPage";
import { BudgetsPage } from "./pages/BudgetsPage";
import { AnomaliesPage } from "./pages/AnomaliesPage";
import { SearchPage } from "./pages/SearchPage";
import { GoalsPage } from "./pages/GoalsPage";
import { DuplicatesPage } from "./pages/DuplicatesPage";
import { UncategorizedPage } from "./pages/UncategorizedPage";
import { TrashPage } from "./pages/TrashPage";
import { SankeyPage } from "./pages/SankeyPage";
import { AnnotationsPage } from "./pages/AnnotationsPage";
import { HelpPage } from "./pages/HelpPage";
import { RulesPage } from "./pages/RulesPage";
import { WordcloudPage } from "./pages/WordcloudPage";
import { HealthPage } from "./pages/HealthPage";
import { WhatIfPage } from "./pages/WhatIfPage";
import { YearReviewPage } from "./pages/YearReviewPage";
import { DigestPage } from "./pages/DigestPage";
import { useDataStore } from "./store/useDataStore";
import { useThemeStore } from "./store/useThemeStore";
import { useBackupStore } from "./store/useBackupStore";
import { useZenmoneyStore } from "./store/useZenmoneyStore";
import { useEditsStore } from "./store/useEditsStore";
import { useDeletedStore } from "./store/useDeletedStore";
import { useReportPeriodStore } from "./store/useReportPeriodStore";
import { useFiltersStore } from "./store/useFiltersStore";

/**
 * All routes use the same outer layout now. Pages that need global filters
 * render `<GlobalFilters />` themselves AFTER `<PageHeader>` — this keeps the
 * page title visually above the filter bar (which the user expects) and makes
 * each route's structure explicit.
 */
function PlainLayout() {
  return <Outlet />;
}

function App() {
  const hydrate = useDataStore((s) => s.hydrate);
  const loaded = useDataStore((s) => s.loaded);
  const initTheme = useThemeStore((s) => s.init);
  const backupHydrate = useBackupStore((s) => s.hydrate);
  const backupRunIfDue = useBackupStore((s) => s.runIfDue);
  const backupLoaded = useBackupStore((s) => s.loaded);
  const reportPeriodHydrate = useReportPeriodStore((s) => s.hydrate);
  const reportPeriodLoaded = useReportPeriodStore((s) => s.loaded);
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const resetToCurrentPeriod = useFiltersStore((s) => s.resetToCurrentPeriod);

  const [paletteOpen, setPaletteOpen] = useState(false);
  useGlobalShortcuts(() => setPaletteOpen(true));

  useEffect(() => {
    // Hydrate the deleted-ids set first so the data store's pipeline
    // filters hidden rows from the very first render. (loadDeletedSet
    // falls back to disk anyway, but this populates the in-memory copy
    // that the UI + auto-push subscription read.)
    useDeletedStore.getState().hydrate();
    hydrate();
    backupHydrate();
    reportPeriodHydrate();
    return initTheme();
  }, [hydrate, backupHydrate, reportPeriodHydrate, initTheme]);

  // Once the report-period setting is known, reset the filter's "current
  // month" to the matching billing period — so that fresh visits always
  // start with the correct window when startDay != 1. We do this only
  // once on first hydrate to avoid stomping over the user's manual
  // month-step navigation later in the session.
  const reportPeriodReconciled = useRef(false);
  useEffect(() => {
    if (!reportPeriodLoaded) return;
    if (reportPeriodReconciled.current) return;
    reportPeriodReconciled.current = true;
    resetToCurrentPeriod(monthStartDay);
  }, [reportPeriodLoaded, monthStartDay, resetToCurrentPeriod]);

  // Once backup settings are loaded, check on mount + every 10 minutes.
  useEffect(() => {
    if (!backupLoaded || !loaded) return;
    backupRunIfDue();
    const id = setInterval(() => backupRunIfDue(), 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [backupLoaded, loaded, backupRunIfDue]);

  // Auto-push debouncer. When pushMode === "auto", we observe the
  // overlay edit count: each change kicks a 2-second timer; if no new
  // edits arrive in that window, we flush the pending edits to Zenmoney.
  //
  // Why 2 s: long enough that filling a modal (date → amount → category
  // → save) coalesces into ONE push, short enough that the user feels
  // the sync is "instant" by the time they look at another screen.
  //
  // Errors don't propagate — pushPendingEdits writes them to the sync
  // log + sets pushError; the UI surfaces them from there.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Shared debounce: any change to either the edit overlay OR the
    // deleted-ids set (re)starts the 2 s countdown and ultimately
    // flushes both via pushPendingEdits (which bundles edits +
    // deletions into one request).
    const schedule = () => {
      const zen = useZenmoneyStore.getState();
      if (zen.pushMode !== "auto" || !zen.token) return;
      const hasEdits =
        Object.keys(useEditsStore.getState().edits).length > 0;
      const hasDeletions =
        useDeletedStore.getState().deletedIds.length > 0;
      if (!hasEdits && !hasDeletions) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const live = useZenmoneyStore.getState();
        // Re-check at fire-time: user may have toggled mode off while
        // the debounce was pending.
        if (live.pushMode !== "auto") return;
        if (live.pushStatus === "syncing") return;
        void useZenmoneyStore.getState().pushPendingEdits().catch(() => {
          /* surfaced via pushError + sync log */
        });
      }, 2000);
    };
    // Only schedule on changes that ADD pending work — otherwise the
    // post-push cleanup (clearing an edit from the overlay) would
    // re-trigger and, because the deleted-id set is monotonic, produce
    // spurious "nothing to send" no-op pushes.
    const unsubEdits = useEditsStore.subscribe((s, p) => {
      if (s.edits === p.edits) return;
      // Fire only when there's actually an edit pending right now.
      if (Object.keys(s.edits).length === 0) return;
      schedule();
    });
    const unsubDeleted = useDeletedStore.subscribe((s, p) => {
      if (s.deletedIds === p.deletedIds) return;
      // Fire only when a NEW id was hidden (length grew) — not on
      // restore/clear, and not just because the set is non-empty.
      if (s.deletedIds.length <= p.deletedIds.length) return;
      schedule();
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubEdits();
      unsubDeleted();
    };
  }, []);

  // Auto-sync poller. We tick every 30 s and ask the Zenmoney store
  // whether a sync is due (it knows the interval setting + last
  // sync timestamp). 30 s is a compromise — fine-grained enough for
  // 1-minute intervals to feel responsive, sparse enough that a
  // suspended tab doesn't burn battery.
  //
  // Pause when the tab is hidden: `runAutoSyncIfDue` is a no-op
  // anyway when status === "syncing", but skipping the call avoids
  // racing with throttled timers in background tabs.
  useEffect(() => {
    let cancelled = false;
    const zen = useZenmoneyStore.getState();
    // Eager hydrate so the very first tick has the persisted
    // interval/enabled values instead of defaults.
    if (!zen.loaded) zen.hydrate();
    const tick = () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      void useZenmoneyStore.getState().runAutoSyncIfDue();
    };
    // Run once on mount and then every 30 s.
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        Загрузка...
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <TopNav onOpenPalette={() => setPaletteOpen(true)} />
      <main className="max-w-[1400px] mx-auto px-4 md:px-6 py-4 md:py-6">
        <Routes>
          <Route element={<PlainLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/settings" element={<ImportPage />} />
            {/* Backwards-compat: the settings page used to live at
                /import. Redirect old bookmarks / shortcuts. */}
            <Route path="/import" element={<Navigate to="/settings" replace />} />
            <Route path="/recurring" element={<RecurringPage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="/budgets" element={<BudgetsPage />} />
            <Route path="/anomalies" element={<AnomaliesPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/goals" element={<GoalsPage />} />
            <Route path="/duplicates" element={<DuplicatesPage />} />
            <Route path="/uncategorized" element={<UncategorizedPage />} />
            <Route path="/trash" element={<TrashPage />} />
            <Route path="/annotations" element={<AnnotationsPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/health" element={<HealthPage />} />
            <Route path="/whatif" element={<WhatIfPage />} />
            <Route path="/year-review" element={<YearReviewPage />} />
            <Route path="/digest" element={<DigestPage />} />
          </Route>
            {/* Filtered pages: GlobalFilters is rendered INSIDE each page right
                after PageHeader (see TransactionsPage, CashflowPage, etc.) so
                the title sits above the filter bar. */}
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/cashflow" element={<CashflowPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/top" element={<TopPage />} />
            <Route path="/trends" element={<TrendsPage />} />
            <Route path="/sankey" element={<SankeyPage />} />
            <Route path="/wordcloud" element={<WordcloudPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <TransactionsDrawer />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ConfirmDialog />
    </div>
  );
}

export default App;
