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
      // Opening balances give the curve its SHAPE, but a manual calibration —
      // when the user set one — is their ground-truth current balance and MUST
      // still win. Passing `null` here used to silently drop it: once the live
      // accounts loaded (async), the chart flipped from the correct calibrated
      // value to the raw opening-seeded total, which can be off (e.g. an
      // account with a bogus 1970 `startDate`, or an off-balance mismatch vs
      // Zenmoney's headline). Anchoring to the calibration cancels any such
      // offset and kills the «верный → завышенный» flicker.
      return netWorthSeries(txs, calibration, basis);
    }
    // CSV / no cache — keep the manual-calibration behaviour.
    return netWorthSeries(txs, calibration);
  }, [txs, liveAccounts, rates, includeOffBalance, calibration]);
}
