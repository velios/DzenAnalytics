/**
 * Dev-only logging helper. Sends one or more log entries to the Vite
 * dev-server endpoint `/_devlog`, which appends them to
 * `dev-logs/app.log` on disk. Lets us grep/tail the log from outside
 * the browser when investigating tricky server-side errors (push
 * failures, restore chunking, etc.) without needing the user to
 * copy-paste the console.
 *
 * In production (`import.meta.env.PROD`) this is a no-op — log calls
 * are silently dropped. The endpoint itself only exists on the dev
 * server too, so the build output never reaches out to anywhere.
 */

export type DevLogLevel = "debug" | "info" | "warn" | "error";

export interface DevLogEntry {
  scope: string;
  level?: DevLogLevel;
  message: string;
}

// Small in-memory buffer: lets us coalesce bursty logging (e.g. many
// chunks of a restore push) into a single round-trip. Flushed on a
// 200ms tail or when the buffer hits 50 entries.
let buffer: DevLogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0) return;
  const payload = buffer;
  buffer = [];
  try {
    await fetch("/_devlog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // Best-effort — if it fails, we don't want to throw inside log
      // code and trip up whatever business logic was logging.
      keepalive: true,
    });
  } catch {
    /* swallow — dev convenience only */
  }
}

function schedule() {
  if (buffer.length >= 50) {
    void flush();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => void flush(), 200);
}

/**
 * Write one entry to the dev log. Safe to call from production code —
 * gated by `import.meta.env.PROD`. Format on disk:
 *
 *   2026-05-27T19:01:23.456Z [info] zen-restore: chunk 3 sent (245 KB)
 */
export function devLog(
  scope: string,
  message: string,
  level: DevLogLevel = "info"
): void {
  if (import.meta.env.PROD) return;
  buffer.push({ scope, level, message });
  schedule();
}
