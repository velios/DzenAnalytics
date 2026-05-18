import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import "./index.css";
import App from "./App";

// HashRouter when opened from file:// (standalone single-file release),
// BrowserRouter when served over http(s).
const isFileProtocol =
  typeof window !== "undefined" && window.location.protocol === "file:";
const Router = isFileProtocol ? HashRouter : BrowserRouter;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>
);

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
