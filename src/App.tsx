import { useEffect, useState } from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { TopNav } from "./components/TopNav";
import { GlobalFilters } from "./components/GlobalFilters";
import { TransactionsDrawer } from "./components/TransactionsDrawer";
import { CommandPalette, useGlobalShortcuts } from "./components/CommandPalette";
import { DashboardPage } from "./pages/DashboardPage";
import { CashflowPage } from "./pages/CashflowPage";
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

function FilteredLayout() {
  return (
    <>
      <GlobalFilters />
      <Outlet />
    </>
  );
}

function PlainLayout() {
  return <Outlet />;
}

function App() {
  const hydrate = useDataStore((s) => s.hydrate);
  const loaded = useDataStore((s) => s.loaded);
  const initTheme = useThemeStore((s) => s.init);

  const [paletteOpen, setPaletteOpen] = useState(false);
  useGlobalShortcuts(() => setPaletteOpen(true));

  useEffect(() => {
    hydrate();
    return initTheme();
  }, [hydrate, initTheme]);

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
            <Route path="/import" element={<ImportPage />} />
            <Route path="/recurring" element={<RecurringPage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="/budgets" element={<BudgetsPage />} />
            <Route path="/anomalies" element={<AnomaliesPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/goals" element={<GoalsPage />} />
            <Route path="/duplicates" element={<DuplicatesPage />} />
            <Route path="/uncategorized" element={<UncategorizedPage />} />
            <Route path="/annotations" element={<AnnotationsPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/health" element={<HealthPage />} />
            <Route path="/whatif" element={<WhatIfPage />} />
            <Route path="/year-review" element={<YearReviewPage />} />
            <Route path="/digest" element={<DigestPage />} />
          </Route>
          <Route element={<FilteredLayout />}>
            <Route path="/cashflow" element={<CashflowPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/top" element={<TopPage />} />
            <Route path="/trends" element={<TrendsPage />} />
            <Route path="/sankey" element={<SankeyPage />} />
            <Route path="/wordcloud" element={<WordcloudPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <TransactionsDrawer />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export default App;
