import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Coins,
  Replace,
  Layers,
  Users,
  Download,
  Database,
  Percent,
  Cloud,
  RefreshCw,
  Loader2,
  KeyRound,
  ExternalLink,
  Eye,
  EyeOff,
  Link as LinkIcon,
  Unlink,
  Clock,
  Settings,
} from "lucide-react";
import { parseCsv } from "../lib/csv";
import { useDataStore } from "../store/useDataStore";
import { useGoalsStore } from "../store/useGoalsStore";
import { useBudgetsStore } from "../store/useBudgetsStore";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useSavedViewsStore } from "../store/useSavedViewsStore";
import { useAnnotationsStore } from "../store/useAnnotationsStore";
import { useCategoryFlagsStore } from "../store/useCategoryFlagsStore";
import { useInflationStore } from "../store/useInflationStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { useBackupStore, type BackupInterval } from "../store/useBackupStore";
import { Combobox } from "../components/Combobox";
import { formatNum, formatDate } from "../lib/format";
import { buildPayeeAliasMap } from "../lib/payeeNormalize";
import * as db from "../lib/db";

type Mode = "replace" | "merge";

export function ImportPage() {
  const nav = useNavigate();
  const setTransactions = useDataStore((s) => s.setTransactions);
  const mergeTransactions = useDataStore((s) => s.mergeTransactions);
  const clearAll = useDataStore((s) => s.clearAll);
  const rates = useDataStore((s) => s.rates);
  const setRate = useDataStore((s) => s.setRate);
  const setBase = useDataStore((s) => s.setBase);
  const transactions = useDataStore((s) => s.transactions);
  const meta = useDataStore((s) => s.importMeta);
  const payeeGrouping = useDataStore((s) => s.payeeGroupingEnabled);
  const setPayeeGrouping = useDataStore((s) => s.setPayeeGrouping);
  const inflation = useInflationStore((s) => s.config);
  const inflationLoaded = useInflationStore((s) => s.loaded);
  const setInflEnabled = useInflationStore((s) => s.setEnabled);
  const setInflBaseYear = useInflationStore((s) => s.setBaseYear);
  const setInflRate = useInflationStore((s) => s.setRate);
  const hydrateInflation = useInflationStore((s) => s.hydrate);
  useEffect(() => {
    if (!inflationLoaded) hydrateInflation();
  }, [inflationLoaded, hydrateInflation]);

  // Zenmoney API sync state
  const zenToken = useZenmoneyStore((s) => s.token);
  const zenStatus = useZenmoneyStore((s) => s.status);
  const zenError = useZenmoneyStore((s) => s.error);
  const zenLastSyncAt = useZenmoneyStore((s) => s.lastSyncAt);
  const zenLoaded = useZenmoneyStore((s) => s.loaded);
  const zenHydrate = useZenmoneyStore((s) => s.hydrate);
  const zenValidateAndSave = useZenmoneyStore((s) => s.validateAndSaveToken);
  const zenSync = useZenmoneyStore((s) => s.sync);
  const zenRemoveToken = useZenmoneyStore((s) => s.removeToken);

  useEffect(() => {
    if (!zenLoaded) zenHydrate();
  }, [zenLoaded, zenHydrate]);

  const [tokenDraft, setTokenDraft] = useState("");
  const [tokenVisible, setTokenVisible] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState<string | null>(null);

  function formatSyncResult(r: {
    count: number;
    full: boolean;
    delta: { transactions: number; deletions: number };
  }): string {
    if (r.full) return `Полный синк: ${formatNum(r.count)} операций.`;
    if (r.delta.transactions === 0 && r.delta.deletions === 0) {
      return `Свежее: ничего нового. Всего ${formatNum(r.count)} операций.`;
    }
    const parts: string[] = [];
    if (r.delta.transactions > 0)
      parts.push(`+${formatNum(r.delta.transactions)} новых/изменённых`);
    if (r.delta.deletions > 0)
      parts.push(`${formatNum(r.delta.deletions)} удалено`);
    return `Синхронизировано: ${parts.join(", ")}. Всего ${formatNum(r.count)} операций.`;
  }

  async function connectToken() {
    setSyncSuccess(null);
    // Guard: existing CSV data will be replaced by API sync.
    if (meta?.source === "csv" && transactions.length > 0) {
      const ok = confirm(
        `У вас сейчас ${formatNum(transactions.length)} операций, загруженных из CSV (${meta.fileName}). API-синк заменит их данными из Дзен-мани. Бюджеты, цели, аннотации и правила сохранятся.\n\nПродолжить?`
      );
      if (!ok) return;
      await clearAll();
    }
    const ok = await zenValidateAndSave(tokenDraft);
    if (ok) {
      setTokenDraft("");
      try {
        const r = await zenSync({ force: true });
        setSyncSuccess(formatSyncResult(r));
      } catch {
        /* error already in store */
      }
    }
  }

  async function runSync() {
    setSyncSuccess(null);
    try {
      const r = await zenSync();
      setSyncSuccess(formatSyncResult(r));
    } catch {
      /* error already in store */
    }
  }

  async function runFullSync() {
    setSyncSuccess(null);
    if (
      !confirm(
        "Полный синк сбросит локальный кэш и заново скачает все данные. Используйте, если данные не сходятся или после массовых переименований категорий в Дзен-мани. Продолжить?"
      )
    )
      return;
    try {
      const r = await zenSync({ force: true });
      setSyncSuccess(formatSyncResult(r));
    } catch {
      /* error already in store */
    }
  }

  async function disconnectToken() {
    if (!confirm("Отключить токен Дзен-мани? Данные останутся, но автосинк станет недоступен.")) return;
    await zenRemoveToken();
    setSyncSuccess(null);
  }

  // Scheduled backup
  const backupInterval = useBackupStore((s) => s.interval);
  const backupLastAt = useBackupStore((s) => s.lastBackupAt);
  const backupLoaded = useBackupStore((s) => s.loaded);
  const backupHydrate = useBackupStore((s) => s.hydrate);
  const setBackupInterval = useBackupStore((s) => s.setInterval);
  const runBackupNow = useBackupStore((s) => s.runNow);
  useEffect(() => {
    if (!backupLoaded) backupHydrate();
  }, [backupLoaded, backupHydrate]);
  const [scheduledMsg, setScheduledMsg] = useState<string | null>(null);
  async function triggerScheduledNow() {
    try {
      const r = await runBackupNow();
      setScheduledMsg(`Скачано ${r.fileName} (${Math.round(r.size / 1024)} КБ)`);
    } catch (e) {
      setScheduledMsg(e instanceof Error ? e.message : "Ошибка");
    }
  }

  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(transactions.length > 0 ? "merge" : "replace");
  const fileRef = useRef<HTMLInputElement>(null);

  const goalsHydrate = useGoalsStore((s) => s.hydrate);
  const budgetsHydrate = useBudgetsStore((s) => s.hydrate);
  const calibHydrate = useCalibrationStore((s) => s.hydrate);
  const viewsHydrate = useSavedViewsStore((s) => s.hydrate);
  const annHydrate = useAnnotationsStore((s) => s.hydrate);
  const flagsHydrate = useCategoryFlagsStore((s) => s.hydrate);
  const dataHydrate = useDataStore((s) => s.hydrate);
  const backupRef = useRef<HTMLInputElement>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  async function exportBackup() {
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const dump = {
        version: 1,
        exportedAt: new Date().toISOString(),
        transactions: await db.loadTransactions(),
        rates: await db.loadRates(),
        importMeta: await db.loadImportMeta(),
        budgets: await db.loadJSON("budgets"),
        goals: await db.loadJSON("goals"),
        calibration: await db.loadJSON("calibration"),
        savedViews: await db.loadJSON("savedViews"),
        annotations: await db.loadJSON("annotations"),
        categoryFlags: await db.loadJSON("categoryFlags"),
        inflation: await db.loadJSON("inflation"),
        payeeGrouping: await db.loadJSON("payeeGrouping"),
      };
      const json = JSON.stringify(dump, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dzenanalytics-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupMsg(`Экспортировано: ${formatNum((dump.transactions || []).length)} операций + настройки`);
    } catch (e) {
      setBackupMsg(e instanceof Error ? `Ошибка: ${e.message}` : "Ошибка экспорта");
    } finally {
      setBackupBusy(false);
    }
  }

  async function importBackup(file: File) {
    if (!confirm("Восстановить из backup'а? Текущие данные будут заменены.")) return;
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const text = await file.text();
      const dump = JSON.parse(text);
      if (!dump.version) throw new Error("Не похоже на backup DzenAnalytics");
      if (dump.transactions) await db.saveTransactions(dump.transactions);
      if (dump.rates) await db.saveRates(dump.rates);
      if (dump.importMeta) await db.saveImportMeta(dump.importMeta);
      const keys = ["budgets", "goals", "calibration", "savedViews", "annotations", "categoryFlags", "inflation", "payeeGrouping"];
      for (const k of keys) {
        if (dump[k] !== undefined) await db.saveJSON(k, dump[k]);
      }
      await Promise.all([
        dataHydrate(),
        goalsHydrate(),
        budgetsHydrate(),
        calibHydrate(),
        viewsHydrate(),
        annHydrate(),
        flagsHydrate(),
        hydrateInflation(),
      ]);
      setBackupMsg(`Восстановлено: ${formatNum((dump.transactions || []).length)} операций`);
    } catch (e) {
      setBackupMsg(e instanceof Error ? `Ошибка: ${e.message}` : "Ошибка импорта backup'а");
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleFile(file: File) {
    setError(null);
    setSuccess(null);
    // Guard: API token connected → confirm before mixing.
    if (zenToken) {
      const ok = confirm(
        "У вас подключён API Дзен-мани. CSV-импорт может затереть синхронизированные данные. Продолжить?\n\nЕсли импорт нужен, советуем сначала отключить API на этой странице, чтобы избежать путаницы."
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const result = await parseCsv(text, rates);
      if (result.parsed === 0) {
        throw new Error("Не удалось распарсить ни одной строки. Проверьте формат файла.");
      }
      const importMeta = {
        importedAt: new Date().toISOString(),
        fileName: file.name,
        totalRows: result.totalRows,
        parsed: result.parsed,
        skipped: result.skipped,
        source: "csv" as const,
      };
      if (mode === "merge" && transactions.length > 0) {
        const r = await mergeTransactions(result.transactions, importMeta);
        setSuccess(
          `Добавлено ${r.added} новых, пропущено ${r.duplicates} дубликатов. Всего: ${formatNum(transactions.length + r.added)}.`
        );
      } else {
        await setTransactions(result.transactions, importMeta);
        setSuccess(`Загружено ${formatNum(result.parsed)} операций.`);
      }
      setTimeout(() => nav("/"), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка чтения файла");
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  const aliasPreview = (() => {
    if (transactions.length === 0) return null;
    const allPayees = transactions.map((t) => t.payeeOriginal || t.payee).filter(Boolean);
    const aliases = buildPayeeAliasMap(allPayees);
    return aliases;
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="w-6 h-6 text-accent shrink-0" />
          Настройки
        </h1>
        <p className="text-muted text-sm mt-1">
          Источник данных, валюты и курсы, резервные копии — всё, что относится
          к настройке приложения.
        </p>
      </div>

      <SectionHeading>Источник данных</SectionHeading>

      {/* Zenmoney API integration */}
      <div className="card card-pad border-accent/30 bg-accent/[0.03]">
        <div className="flex items-start justify-between mb-3 flex-wrap gap-3">
          <div>
            <div className="font-semibold flex items-center gap-2">
              <Cloud className="w-4 h-4 text-accent" />
              Дзен-мани API (онлайн-синхронизация)
            </div>
            <p className="text-xs text-muted mt-1 max-w-prose">
              Качает данные напрямую из вашего аккаунта Дзен-мани. Кроме операций
              получим также курсы валют, баланс счетов, регулярные платежи и
              иерархию категорий — без выгрузки CSV.
            </p>
          </div>
          {zenToken && zenStatus !== "syncing" && (
            <button
              onClick={disconnectToken}
              className="btn-ghost text-xs text-muted"
              title="Удалить токен из браузера"
            >
              <Unlink className="w-3.5 h-3.5" />
              Отключить
            </button>
          )}
        </div>

        {!zenToken ? (
          <div className="space-y-3">
            <div className="text-xs text-muted">
              <KeyRound className="w-3.5 h-3.5 inline align-text-bottom mr-1" />
              Личный токен — это длинная строка из букв и цифр. Получить можно в{" "}
              <a
                href="https://zerro.app/token"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline inline-flex items-center gap-0.5"
              >
                zerro.app/token <ExternalLink className="w-3 h-3" />
              </a>{" "}
              (войдите своим логином от Дзен-мани, скопируйте токен). Хранится только в этом
              браузере — никуда не отправляется.
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type={tokenVisible ? "text" : "password"}
                  value={tokenDraft}
                  onChange={(e) => setTokenDraft(e.target.value)}
                  placeholder="Вставьте токен"
                  className="input text-sm pr-9 w-full font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={zenStatus === "checking" || zenStatus === "syncing"}
                />
                <button
                  type="button"
                  onClick={() => setTokenVisible((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                  title={tokenVisible ? "Скрыть" : "Показать"}
                >
                  {tokenVisible ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              <button
                onClick={connectToken}
                disabled={
                  !tokenDraft.trim() ||
                  zenStatus === "checking" ||
                  zenStatus === "syncing"
                }
                className="btn-primary text-sm whitespace-nowrap"
              >
                {zenStatus === "checking" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : zenStatus === "syncing" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <LinkIcon className="w-3.5 h-3.5" />
                )}
                {zenStatus === "checking"
                  ? "Проверяю..."
                  : zenStatus === "syncing"
                    ? "Качаю данные..."
                    : "Подключить и синхронизировать"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-income" />
              <span className="text-text">Подключено</span>
              {zenLastSyncAt && (
                <span className="text-xs text-muted">
                  · последний синк {new Date(zenLastSyncAt).toLocaleString("ru-RU")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={runFullSync}
                disabled={zenStatus === "syncing"}
                className="btn-ghost text-xs text-muted"
                title="Сбросить локальный кэш и скачать всё заново"
              >
                Полный синк
              </button>
              <button
                onClick={runSync}
                disabled={zenStatus === "syncing"}
                className="btn-primary text-sm"
              >
                {zenStatus === "syncing" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                {zenStatus === "syncing" ? "Синхронизирую..." : "Синхронизировать"}
              </button>
            </div>
          </div>
        )}

        {zenError && (
          <div className="mt-3 text-xs text-expense flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{zenError}</span>
          </div>
        )}
        {syncSuccess && (
          <div className="mt-3 text-xs text-income flex items-start gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{syncSuccess}</span>
          </div>
        )}
      </div>

      {/* CSV import — alternative source */}
      <p className="text-muted text-sm -mt-2">
        Или загрузить CSV-выгрузку из Дзен-мани (формат:{" "}
        <code className="pill">date;categoryName;…</code>):
      </p>

      {transactions.length > 0 && (
        <div className="card card-pad">
          <div className="font-medium mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4 text-accent" />
            Режим импорта
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={() => setMode("merge")}
              className={`p-4 rounded-lg border text-left transition-colors ${
                mode === "merge"
                  ? "bg-accent/10 border-accent"
                  : "bg-panel2 border-border hover:border-accent/50"
              }`}
            >
              <div className="font-medium text-sm flex items-center gap-2">
                <Layers className="w-4 h-4" />
                Дополнить
              </div>
              <div className="text-xs text-muted mt-1">
                Добавить новые операции к существующим. Дубликаты по id отбрасываются.
              </div>
            </button>
            <button
              onClick={() => setMode("replace")}
              className={`p-4 rounded-lg border text-left transition-colors ${
                mode === "replace"
                  ? "bg-accent/10 border-accent"
                  : "bg-panel2 border-border hover:border-accent/50"
              }`}
            >
              <div className="font-medium text-sm flex items-center gap-2">
                <Replace className="w-4 h-4" />
                Заменить
              </div>
              <div className="text-xs text-muted mt-1">
                Удалить текущие данные и загрузить файл с нуля.
              </div>
            </button>
          </div>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`card card-pad cursor-pointer transition-all border-2 border-dashed ${
          dragOver ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
        }`}
      >
        <div className="flex flex-col items-center text-center py-10 gap-3">
          <Upload className="w-12 h-12 text-accent" />
          <div className="font-medium">
            {busy ? "Обрабатываю..." : "Перетащите CSV-файл сюда или кликните для выбора"}
          </div>
          <div className="text-xs text-muted">
            {transactions.length > 0
              ? `Сейчас в базе: ${formatNum(transactions.length)} операций. Режим: ${mode === "merge" ? "дополнить" : "заменить"}.`
              : "Файл обрабатывается локально, в браузере. Никуда не отправляется."}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      </div>

      {error && (
        <div className="card card-pad border-expense/40 bg-expense/10">
          <div className="flex items-center gap-2 text-expense">
            <AlertTriangle className="w-5 h-5" />
            {error}
          </div>
        </div>
      )}

      {success && (
        <div className="card card-pad border-income/40 bg-income/10">
          <div className="flex items-center gap-2 text-income">
            <CheckCircle2 className="w-5 h-5" />
            {success}
          </div>
        </div>
      )}

      {meta && (
        <div className="card card-pad">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-5 h-5 text-income" />
            <span className="font-medium">Текущая база</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="label mb-1">Последний файл</div>
              <div className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-muted" />
                <span className="truncate" title={meta.fileName}>
                  {meta.fileName}
                </span>
              </div>
            </div>
            <div>
              <div className="label mb-1">Импортировано</div>
              <div>{formatDate(meta.importedAt)}</div>
            </div>
            <div>
              <div className="label mb-1">Всего операций</div>
              <div className="font-semibold">{formatNum(transactions.length)}</div>
            </div>
            <div>
              <div className="label mb-1">Период</div>
              <div className="text-xs">
                {transactions.length > 0 && (
                  <>
                    {formatDate(
                      transactions.reduce(
                        (m, t) => (t.date < m ? t.date : m),
                        transactions[0].date
                      )
                    )}
                    {" — "}
                    {formatDate(
                      transactions.reduce(
                        (m, t) => (t.date > m ? t.date : m),
                        transactions[0].date
                      )
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-border flex items-center justify-between flex-wrap gap-3">
            <div>
              <button
                onClick={async () => {
                  if (
                    confirm(
                      "Удалить все локально сохранённые транзакции из этого браузера?\n\nДанные в Дзен-мани НЕ пострадают — мы вообще ничего туда не пишем."
                    )
                  ) {
                    await clearAll();
                  }
                }}
                className="btn-danger text-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Очистить локальные данные
              </button>
              <div className="text-[11px] text-muted mt-2 max-w-prose">
                Удалит только локальную копию операций в этом браузере.{" "}
                <strong className="text-text">Данные в облаке Дзен-мани не трогаем</strong>
                {" "}— приложение работает в режиме «только чтение» из API и ничего туда не пишет.
              </div>
            </div>
            <button onClick={() => nav("/")} className="btn-primary text-sm">
              Открыть аналитику →
            </button>
          </div>
        </div>
      )}

      <SectionHeading>Валюты и инфляция</SectionHeading>

      <div className="card card-pad">
        <div className="flex items-center gap-2 mb-3">
          <Coins className="w-5 h-5 text-accent2" />
          <span className="font-medium">
            {zenToken ? "Валюта" : `Курсы валют (к ${rates.base})`}
          </span>
        </div>
        <p className="text-xs text-muted mb-4">
          {zenToken
            ? "Курсы тянутся из Дзен-мани при каждой синхронизации — настраивать вручную не нужно. Здесь только выбор базовой валюты, в которой показываются KPI и графики."
            : "Используются для сведения операций в разных валютах в единую базу. Меняйте здесь, если нужны точные курсы. Все суммы пересчитываются автоматически."}
        </p>
        <div className={zenToken ? "" : "mb-4"}>
          <label className="label block mb-1">Базовая валюта</label>
          <div className="flex items-center gap-2">
            <div className="w-32">
              <Combobox
                value={rates.base}
                options={Object.keys(rates.rates).sort()}
                onChange={(next) => {
                  setBase(next).catch((err: Error) => alert(err.message));
                }}
                allowCustom={false}
                maxHeight="min(40vh, 280px)"
              />
            </div>
            <span className="text-xs text-muted">
              В этой валюте показываются все KPI и графики
            </span>
          </div>
        </div>
        {!zenToken && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(rates.rates).map(([cur, val]) => (
              <div key={cur}>
                <label className="label block mb-1">1 {cur} =</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.01"
                    value={val}
                    onChange={(e) => setRate(cur, Number(e.target.value) || 0)}
                    disabled={cur === rates.base}
                    className="input text-sm"
                  />
                  <span className="text-xs text-muted">{rates.base}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card card-pad">
        <div className="flex items-center gap-2 mb-3">
          <Percent className="w-5 h-5 text-accent2" />
          <span className="font-medium">Поправка на инфляцию</span>
        </div>
        <p className="text-xs text-muted mb-3">
          Когда включено, все суммы пересчитываются в реальные деньги базового года: расход в 2022
          умножается на накопленную инфляцию до базового. Полезно для честного сравнения трат за
          разные годы.
        </p>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={inflation.enabled}
              onChange={(e) => setInflEnabled(e.target.checked)}
              className="accent-accent w-4 h-4"
            />
            Включить
          </label>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Базовый год:</span>
            <input
              type="number"
              value={inflation.baseYear}
              onChange={(e) => setInflBaseYear(Number(e.target.value) || 2026)}
              className="input text-sm w-24"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Object.entries(inflation.rates)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([year, rate]) => (
              <div key={year}>
                <label className="label block mb-1">{year}</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.1"
                    value={rate}
                    onChange={(e) =>
                      setInflRate(year, Number(e.target.value) || 0)
                    }
                    className="input text-sm"
                  />
                  <span className="text-xs text-muted">%</span>
                </div>
              </div>
            ))}
        </div>
        <div className="text-[11px] text-muted mt-3">
          Поправка применяется к графикам Cash-flow и Тренды (когда включено в этих разделах).
        </div>
      </div>

      {transactions.length > 0 && <SectionHeading>Обработка данных</SectionHeading>}
      {transactions.length > 0 && (
        <div className="card card-pad">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-5 h-5 text-accent2" />
            <span className="font-medium">Группировка похожих получателей</span>
          </div>
          <p className="text-xs text-muted mb-3">
            Объединяет варианты одного и того же получателя через нормализацию (удаление номеров,
            пробелов, форм. суффиксов, лидирующих банков). Например, «Магнит #1234» и «MAGNIT-MOSCOW»
            → один payee.
          </p>
          <label className="flex items-center gap-3 p-3 bg-panel2 rounded-lg border border-border cursor-pointer">
            <input
              type="checkbox"
              checked={payeeGrouping}
              onChange={(e) => setPayeeGrouping(e.target.checked)}
              className="accent-accent w-4 h-4"
            />
            <div className="flex-1">
              <div className="font-medium text-sm">
                {payeeGrouping ? "Группировка включена" : "Группировка выключена"}
              </div>
              <div className="text-xs text-muted">
                {aliasPreview && aliasPreview.size > 0
                  ? `Найдено вариантов: ${aliasPreview.size}. Toggle обратимый — можно вернуть оригинальные имена.`
                  : "Похожих получателей не найдено в текущих данных."}
              </div>
            </div>
          </label>
          {payeeGrouping && aliasPreview && aliasPreview.size > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-accent cursor-pointer hover:underline">
                Показать применённые объединения ({aliasPreview.size})
              </summary>
              <div className="mt-2 max-h-60 overflow-y-auto text-xs space-y-1">
                {Array.from(aliasPreview.entries()).slice(0, 50).map(([from, to]) => (
                  <div key={from} className="flex items-center gap-2 text-muted">
                    <span className="truncate flex-1" title={from}>{from}</span>
                    <span>→</span>
                    <span className="text-text truncate flex-1" title={to}>{to}</span>
                  </div>
                ))}
                {aliasPreview.size > 50 && (
                  <div className="text-muted">…и ещё {aliasPreview.size - 50}</div>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      <SectionHeading>Резервные копии</SectionHeading>
      <div className="card card-pad">
        <div className="flex items-center gap-2 mb-3">
          <Database className="w-5 h-5 text-accent" />
          <span className="font-medium">Backup всех данных</span>
        </div>
        <p className="text-xs text-muted mb-3">
          Экспортирует JSON со всеми транзакциями, бюджетами, целями, калибровкой, видами,
          аннотациями, тегами категорий, инфляцией и настройкой группировки. Импорт восстанавливает
          всё одним файлом.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={exportBackup}
            disabled={backupBusy || transactions.length === 0}
            className="btn-primary text-sm"
          >
            <Download className="w-4 h-4" />
            Скачать backup
          </button>
          <button
            onClick={() => backupRef.current?.click()}
            disabled={backupBusy}
            className="btn-ghost text-sm"
          >
            <Upload className="w-4 h-4" />
            Восстановить из backup
          </button>
          <input
            ref={backupRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importBackup(f);
              e.target.value = "";
            }}
          />
          {backupMsg && (
            <span className="text-xs text-muted self-center">{backupMsg}</span>
          )}
        </div>
      </div>

      {/* Scheduled backup */}
      <div className="card card-pad">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-5 h-5 text-accent" />
          <span className="font-medium">Бэкап по расписанию</span>
        </div>
        <p className="text-xs text-muted mb-3">
          Автоматически скачивает JSON-бэкап с указанной периодичностью. Проверка
          запускается при открытии приложения и каждые ~10 минут. Файл уходит в
          стандартную папку загрузок браузера.
          <br />
          <strong>Важно:</strong> работает только пока вкладка открыта. Браузер
          может показать уведомление о скачивании — это нормально.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          {(["off", "hour", "day", "week"] as BackupInterval[]).map((i) => {
            const label = {
              off: "Выключен",
              hour: "Каждый час",
              day: "Каждый день",
              week: "Каждую неделю",
            }[i];
            const active = backupInterval === i;
            return (
              <button
                key={i}
                onClick={() => setBackupInterval(i)}
                className={`p-2 rounded-lg border text-xs text-left transition-colors ${
                  active
                    ? "bg-accent/10 border-accent text-accent"
                    : "bg-panel2 border-border hover:border-accent/50"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button
            onClick={triggerScheduledNow}
            disabled={transactions.length === 0}
            className="btn-ghost"
          >
            <Download className="w-3.5 h-3.5" />
            Скачать сейчас
          </button>
          <span className="text-muted">
            {backupLastAt
              ? `Последний бэкап: ${new Date(backupLastAt).toLocaleString("ru-RU")}`
              : "Бэкапов ещё не было"}
          </span>
          {scheduledMsg && <span className="text-income">{scheduledMsg}</span>}
        </div>
      </div>

    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wider text-muted px-1 pt-2">
      {children}
    </h2>
  );
}
