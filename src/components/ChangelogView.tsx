import type { ReactNode } from "react";
// Raw markdown of the project changelog — the single source of truth. Vite's
// `?raw` import inlines the file's text at build time, so the in-app «История
// изменений» never drifts from CHANGELOG.md.
import changelogRaw from "../../CHANGELOG.md?raw";

/**
 * A deliberately small Markdown renderer — enough for our CHANGELOG across all
 * releases: `##`/`###` headings, `-`/`1.` lists (with wrapped continuation
 * lines), `>` quotes, fenced code blocks, paragraphs, and inline `**bold**`,
 * `` `code` `` and `[text](url)` links. No external dependency, no
 * `dangerouslySetInnerHTML`.
 */
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    // Recurse into bold so nested markup (e.g. **[link](url)**) still renders.
    if (m[1]) out.push(<strong key={key++}>{renderInline(m[1])}</strong>);
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
  let para: string[] = [];
  let list: string[] = [];
  let listOrdered = false;
  let quote: string[] = [];
  let code: string[] = [];
  let inCode = false;
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={key++} className="mt-2 leading-relaxed">
          {renderInline(para.join(" "))}
        </p>
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      const items = list;
      const cls = "list-inside space-y-1 mt-2 " + (listOrdered ? "list-decimal" : "list-disc");
      blocks.push(
        listOrdered ? (
          <ol key={key++} className={cls}>
            {items.map((li, i) => (
              <li key={i}>{renderInline(li)}</li>
            ))}
          </ol>
        ) : (
          <ul key={key++} className={cls}>
            {items.map((li, i) => (
              <li key={i}>{renderInline(li)}</li>
            ))}
          </ul>
        )
      );
      list = [];
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      blocks.push(
        <blockquote
          key={key++}
          className="mt-2 border-l-2 border-accent/40 pl-3 text-muted italic"
        >
          {renderInline(quote.join(" "))}
        </blockquote>
      );
      quote = [];
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const raw of md.split("\n")) {
    // Fenced code blocks — collect verbatim between ``` markers.
    if (/^\s*```/.test(raw)) {
      if (inCode) {
        blocks.push(
          <pre
            key={key++}
            className="mt-2 p-3 rounded-lg bg-panel2 overflow-x-auto text-xs"
          >
            <code>{code.join("\n")}</code>
          </pre>
        );
        code = [];
        inCode = false;
      } else {
        flushAll();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(raw);
      continue;
    }

    const line = raw.replace(/\s+$/, "");
    if (/^#\s/.test(line)) {
      // Top-level "# Changelog" — the modal/section has its own title; skip.
      flushAll();
      continue;
    }
    if (/^##\s/.test(line)) {
      flushAll();
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
      flushAll();
      blocks.push(
        <h4 key={key++} className="font-semibold mt-3">
          {renderInline(line.replace(/^###\s/, ""))}
        </h4>
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      flushList();
      const q = line.replace(/^>\s?/, "");
      // Drop GitHub admonition markers («> [!NOTE]» etc.) — render just the text.
      if (!/^\[!\w+\]\s*$/.test(q)) quote.push(q);
      continue;
    }
    if (/^-\s/.test(line)) {
      flushPara();
      flushQuote();
      if (listOrdered) flushList();
      listOrdered = false;
      list.push(line.replace(/^-\s/, ""));
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      flushPara();
      flushQuote();
      if (!listOrdered) flushList();
      listOrdered = true;
      list.push(line.replace(/^\d+\.\s/, ""));
      continue;
    }
    // Indented continuation of the current list item (wrapped long line).
    if (list.length > 0 && /^\s+\S/.test(raw)) {
      list[list.length - 1] += " " + line.trim();
      continue;
    }
    if (line.trim() === "") {
      flushAll();
      continue;
    }
    flushList();
    flushQuote();
    para.push(line.trim());
  }
  // Unterminated code fence at EOF — emit what we collected instead of dropping it.
  if (inCode && code.length) {
    blocks.push(
      <pre
        key={key++}
        className="mt-2 p-3 rounded-lg bg-panel2 overflow-x-auto text-xs"
      >
        <code>{code.join("\n")}</code>
      </pre>
    );
  }
  flushAll();
  return blocks;
}

export function ChangelogView() {
  return <div className="text-sm">{renderMarkdown(changelogRaw)}</div>;
}
