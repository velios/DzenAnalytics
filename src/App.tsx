import { useEffect } from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { TopNav } from "./components/TopNav";
import { GlobalFilters } from "./components/GlobalFilters";
import { TransactionsDrawer } from "./components/TransactionsDrawer";
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
      <TopNav />
      <main className="max-w-[1400px] mx-auto px-6 py-6">
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
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <TransactionsDrawer />
    </div>
  );
}

export default App;
