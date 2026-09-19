import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter, MemoryRouter } from "react-router-dom";
// Geist (Vercel) — self-hosted variable fonts, bundled so the standalone build
// stays offline-friendly. Sans for UI, Mono for tabular numbers.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import App from "./App";
import { consumeOAuthCallback, exchangeCode } from "./lib/oauth";
import { useZenmoneyStore } from "./store/useZenmoneyStore";

const isFileProtocol =
  typeof window !== "undefined" && window.location.protocol === "file:";
// Адреса разделов после «#» (HashRouter) — у однофайловой сборки ВСЕГДА, а не
// только при открытии с диска. Её кладут на любой хостинг одним файлом и
// встраивают во фрейм чужого сайта. С обычными адресами приложение переписывало
// адрес фрейма на `/transactions` и т. п.: такого файла на сервере нет, и
// любая перезагрузка — восстановление бэкапа, очистка данных, F5 — упиралась в
// 404. Хэш остаётся внутри того же файла.
// Это входной файл, а не компонент с горячей перезагрузкой, — правило
// fast-refresh к константе `Router` не относится.
//
// Документ без настоящего адреса — HTML, вставленный во фрейм через `srcdoc`
// (`about:srcdoc`) или `data:`, — не даёт собрать URL вовсе: react-router
// падал на первом же переходе. Там разделы переключаются в памяти, без адреса.
const hasRealUrl =
  typeof window === "undefined" ||
  ["http:", "https:", "file:", "blob:"].includes(window.location.protocol);
// eslint-disable-next-line react-refresh/only-export-components
const Router = !hasRealUrl
  ? MemoryRouter
  : isFileProtocol || __STANDALONE__
    ? HashRouter
    : BrowserRouter;

const callback = consumeOAuthCallback();
if (callback) document.getElementById("root")!.textContent = "Завершаем вход...";

async function mount() {
  let syncAfterLogin = sessionStorage.getItem("dzenanalyticsSyncAfterLogin") === "1";
  sessionStorage.removeItem("dzenanalyticsSyncAfterLogin");
  if (syncAfterLogin) await useZenmoneyStore.getState().hydrate();
  if (callback) {
    const store = useZenmoneyStore;
    await store.getState().hydrate();
    try {
      if ("error" in callback) throw new Error("Не удалось проверить вход. Попробуйте снова.");
      const token = await exchangeCode(callback.code);
      syncAfterLogin = await store.getState().validateAndSaveToken(token);
      if (store.getState().status === "checking") return;
    } catch {
      store.setState({ status: "error", error: "Не удалось завершить вход. Попробуйте снова." });
    }
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Router useTransitions={false}>
        <App />
      </Router>
    </StrictMode>
  );
  if (syncAfterLogin) {
    void useZenmoneyStore.getState().sync().catch(() => { /* Error is displayed by the store. */ });
  }
}

void mount();

// Service worker — только у обычной сборки на http(s). В однофайловой его
// файла нет: регистрация лишь сыпала 404 в консоль хоста.
if (
  "serviceWorker" in navigator &&
  import.meta.env.PROD &&
  !isFileProtocol &&
  !__STANDALONE__
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // ignore registration failures
    });
  });
}
