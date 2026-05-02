import clsx from "clsx";
import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "income" | "expense" | "warn";
  icon?: ReactNode;
}

export function Stat({ label, value, hint, tone = "default", icon }: Props) {
  const toneClass = {
    default: "text-text",
    income: "text-income",
    expense: "text-expense",
    warn: "text-warn",
  }[tone];
  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between mb-2">
        <div className="label">{label}</div>
        {icon && <div className="text-muted">{icon}</div>}
      </div>
      <div className={clsx("stat-num", toneClass)}>{value}</div>
      {hint && <div className="text-xs text-muted mt-1">{hint}</div>}
    </div>
  );
}
