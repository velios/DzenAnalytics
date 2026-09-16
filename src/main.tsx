import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
// Geist (Vercel) — self-hosted variable fonts, bundled so the standalone build
// stays offline-friendly. Sans for UI, Mono for tabular numbers.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import App from "./App";
import { consumeOAuthCallback, exchangeCode } from "./lib/oauth";
import { useZenmoneyStore } from "./store/useZenmoneyStore";

// HashRouter when opened from file:// (standalone single-file release),
// BrowserRouter when served over http(s). This is the app entry file,
// not a hot-reloadable component module, so the fast-refresh rule
// doesn't apply to the `Router` const here.
const isFileProtocol =
  typeof window !== "undefined" && window.location.protocol === "file:";
// eslint-disable-next-line react-refresh/only-export-components
const Router = isFileProtocol ? HashRouter : BrowserRouter;

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
      <Router>
        <App />
      </Router>
    </StrictMode>
  );
  if (syncAfterLogin) {
    void useZenmoneyStore.getState().sync().catch(() => { /* Error is displayed by the store. */ });
  }
}

void mount();

// Register service worker only when served over http(s) in production.
if (
  "serviceWorker" in navigator &&
  import.meta.env.PROD &&
  !isFileProtocol
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // ignore registration failures
    });
  });
}
