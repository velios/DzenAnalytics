import { useEffect, useMemo, useState } from "react";
import type { Transaction } from "../types";
import { netWorthSeries, netWorthBasis } from "../lib/aggregations";
import { useDataStore } from "../store/useDataStore";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useOffBalanceStore } from "../store/useOffBalanceStore";
import {
  getLiveAccountsFromCache,
  type LiveAccount,
} from "../store/useZenmoneyStore";

/**
 * Net-worth series corrected for account opening balances (issue #3).
 *
 * In API mode each account's `startBalance` is seeded at its opening date, so
 * the curve reflects initial capital from the right moment — no artificial dip
 * into the negative early in history — and ends exactly at the real total
 * (matching FIRE / «Совокупный баланс»). CSV mode (no live cache) falls back to
 * the manual calibration offset.
 */
export function useNetWorthSeries(
  txs: Transaction[]
): { date: string; net: number }[] {
  const rates = useDataStore((s) => s.rates);
  const calibration = useCalibrationStore((s) => s.calibration);
  const includeOffBalance = useOffBalanceStore((s) => s.includeOffBalance);
  const [liveAccounts, setLiveAccounts] = useState<LiveAccount[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLiveAccountsFromCache().then((data) => {
      if (!cancelled) setLiveAccounts(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    if (liveAccounts && liveAccounts.length > 0) {
      const basis = netWorthBasis(liveAccounts, txs, rates, includeOffBalance);
      return netWorthSeries(txs, null, basis);
    }
    // CSV / no cache — keep the manual-calibration behaviour.
    return netWorthSeries(txs, calibration);
  }, [txs, liveAccounts, rates, includeOffBalance, calibration]);
}
