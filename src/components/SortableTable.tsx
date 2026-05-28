import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpDown, Download } from "lucide-react";
import clsx from "clsx";

export type SortDir = "asc" | "desc";

export interface Column<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  width?: string;
  sortable?: boolean;
  sortValue?: (row: T) => string | number | null | undefined;
  exportValue?: (row: T) => string | number | null | undefined;
  render: (row: T, index: number) => ReactNode;
}

interface Props<T> {
  data: T[];
  columns: Column<T>[];
  rowKey: (row: T, index: number) => string | number;
  defaultSortKey?: string;
  defaultSortDir?: SortDir;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  emptyText?: string;
  limit?: number;
  className?: string;
  exportName?: string;
  exportable?: boolean;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Defuse CSV/spreadsheet formula injection: prefix risky leading chars with '
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  if (s.includes(";") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function SortableTable<T>({
  data,
  columns,
  rowKey,
  defaultSortKey,
  defaultSortDir = "desc",
  onRowClick,
  rowClassName,
  emptyText = "Нет данных",
  limit,
  className,
  exportName,
  exportable = true,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | undefined>(defaultSortKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir);

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col || !col.sortValue) return data;
    const arr = [...data];
    arr.sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      const naN = va === null || va === undefined;
      const nbN = vb === null || vb === undefined;
      if (naN && nbN) return 0;
      if (naN) return 1;
      if (nbN) return -1;
      let r: number;
      if (typeof va === "number" && typeof vb === "number") r = va - vb;
      else r = String(va).localeCompare(String(vb), "ru");
      return sortDir === "asc" ? r : -r;
    });
    return arr;
  }, [data, columns, sortKey, sortDir]);

  function toggleSort(key: string) {
    const col = columns.find((c) => c.key === key);
    if (!col || col.sortable === false || !col.sortValue) return;
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function exportCsv() {
    const header = columns.map((c) => csvEscape(c.label)).join(";");
    const lines = [header];
    for (const row of sorted) {
      const cells = columns.map((c) => {
        let val: unknown;
        if (c.exportValue) val = c.exportValue(row);
        else if (c.sortValue) val = c.sortValue(row);
        else val = "";
        return csvEscape(val);
      });
      lines.push(cells.join(";"));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    const safe = (exportName || "table").toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi, "_");
    a.href = url;
    a.download = `dzenanalytics_${safe}_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const visible = limit ? sorted.slice(0, limit) : sorted;
  const showExport = exportable && sorted.length > 0;

  return (
    <div className={clsx(className)}>
      {showExport && (
        <div className="flex items-center justify-end mb-2">
          <button
            onClick={exportCsv}
            className="btn-ghost text-xs"
            title={`Скачать как CSV (${sorted.length} строк)`}
          >
            <Download className="w-3.5 h-3.5" />
            CSV ({sorted.length})
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {columns.map((c) => {
                const sortable = c.sortable !== false && !!c.sortValue;
                const active = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    className={clsx("table-th", c.align === "right" && "text-right")}
                    style={c.width ? { width: c.width } : undefined}
                  >
                    {sortable ? (
                      <button
                        onClick={() => toggleSort(c.key)}
                        className={clsx(
                          "inline-flex items-center gap-1 hover:text-text transition-colors",
                          active && "text-accent"
                        )}
                      >
                        {c.label}
                        <ArrowUpDown className={clsx("w-3 h-3", !active && "opacity-30")} />
                        {active && (
                          <span className="text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>
                        )}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="table-td text-center text-muted py-6">
                  {emptyText}
                </td>
              </tr>
            ) : (
              visible.map((row, i) => (
                <tr
                  key={rowKey(row, i)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={clsx(
                    "align-top",
                    onRowClick && "hover:bg-panel2/50 cursor-pointer",
                    rowClassName?.(row)
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={clsx("table-td", c.align === "right" && "text-right")}
                    >
                      {c.render(row, i)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {limit && sorted.length > limit && (
        <div className="text-xs text-muted text-center mt-3">
          Показано {limit} из {sorted.length}
        </div>
      )}
    </div>
  );
}
