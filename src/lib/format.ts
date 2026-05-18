import type { CSSProperties } from "react";
import type { Currency } from "../types";

const symbolByCurrency: Record<string, string> = {
  RUB: "₽",
  USD: "$",
  EUR: "€",
  GBP: "£",
  CNY: "¥",
  JPY: "¥",
  KZT: "₸",
  BYN: "Br",
  GEL: "₾",
  AMD: "֏",
  AED: "د.إ",
  TRY: "₺",
  THB: "฿",
};

export function formatMoney(amount: number, currency: Currency = "RUB", opts?: { compact?: boolean; signed?: boolean }): string {
  const sign = opts?.signed && amount > 0 ? "+" : "";
  const abs = Math.abs(amount);
  const fmt = new Intl.NumberFormat("ru-RU", {
    notation: opts?.compact ? "compact" : "standard",
    maximumFractionDigits: opts?.compact ? 1 : abs >= 1000 ? 0 : 2,
  });
  const symbol = symbolByCurrency[currency] || currency;
  const value = fmt.format(amount < 0 ? -abs : abs);
  return `${sign}${value} ${symbol}`;
}

export function formatNum(value: number, opts?: { compact?: boolean }): string {
  return new Intl.NumberFormat("ru-RU", {
    notation: opts?.compact ? "compact" : "standard",
    maximumFractionDigits: opts?.compact ? 1 : value >= 1000 ? 0 : 2,
  }).format(value);
}

export function formatDate(iso: string, fmt: "short" | "medium" | "month" = "medium"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (fmt === "short") return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  if (fmt === "month") return d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function ymKey(iso: string): string {
  return iso.slice(0, 7);
}

export function ymdKey(iso: string): string {
  return iso.slice(0, 10);
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" });
}

export function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v) || 0;
  return 0;
}

export const chartTooltipStyle: CSSProperties = {
  background: "var(--tooltip-bg)",
  border: "1px solid var(--tooltip-border)",
  borderRadius: 8,
  color: "rgb(var(--c-text))",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  boxShadow:
    "0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08)",
};

export const chartTooltipProps = {
  contentStyle: chartTooltipStyle,
  cursor: false as const,
};

export const chartGridStroke = "var(--grid)";
export const chartAxisStroke = "rgb(var(--c-muted))";
