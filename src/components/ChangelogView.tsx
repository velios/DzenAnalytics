import type { ReactNode } from "react";
// Raw markdown of the project changelog — the single source of truth. Vite's
// `?raw` import inlines the file's text at build time, so the in-app «История
// изменений» never drifts from CHANGELOG.md.
import changelogRaw from "../../CHANGELOG.md?raw";

/**
 * A deliberately tiny Markdown renderer — just enough for our CHANGELOG:
 * `##`/`###` headings, `-` bullets (with wrapped continuation lines),
 * paragraphs, and inline `**bold**`, `` `code` `` and `[text](url)` links.
 * No external dependency, no `dangerouslySetInnerHTML`.
 */
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={key++}>{m[1]}</strong>);
    else if (m[2])
      out.push(
        <code key={key++} className="px-1 py-0.5 rounded bg-panel2 text-[0.85em]">
          {m[2]}
        </code>
      );
    else if (m[3])
      out.push(
        <a
          key={key++}
          href={m[4]}
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          {m[3]}
        </a>
      );
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderMarkdown(md: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  const para: string[] = [];
  const list: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={key++} className="mt-2 leading-relaxed">
          {renderInline(para.join(" "))}
        </p>
      );
      para.length = 0;
    }
  };
  const flushList = () => {
    if (list.length) {
      const items = [...list];
      blocks.push(
        <ul key={key++} className="list-disc list-inside space-y-1 mt-2">
          {items.map((li, i) => (
            <li key={i}>{renderInline(li)}</li>
          ))}
        </ul>
      );
      list.length = 0;
    }
  };

  for (const raw of md.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    // Top-level "# Changelog" — the section already has its own title; skip.
    if (/^#\s/.test(line)) {
      flushPara();
      flushList();
      continue;
    }
    if (/^##\s/.test(line)) {
      flushPara();
      flushList();
      blocks.push(
        <h3
          key={key++}
          className="text-base font-bold mt-6 pt-4 border-t border-border first:mt-0 first:pt-0 first:border-0"
        >
          {renderInline(line.replace(/^##\s/, ""))}
        </h3>
      );
      continue;
    }
    if (/^###\s/.test(line)) {
      flushPara();
      flushList();
      blocks.push(
        <h4 key={key++} className="font-semibold mt-3">
          {renderInline(line.replace(/^###\s/, ""))}
        </h4>
      );
      continue;
    }
    if (/^-\s/.test(line)) {
      flushPara();
      list.push(line.replace(/^-\s/, ""));
      continue;
    }
    // Indented continuation of the current bullet (wrapped long line).
    if (list.length > 0 && /^\s+\S/.test(raw)) {
      list[list.length - 1] += " " + line.trim();
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

export function ChangelogView() {
  return <div className="text-sm">{renderMarkdown(changelogRaw)}</div>;
}
