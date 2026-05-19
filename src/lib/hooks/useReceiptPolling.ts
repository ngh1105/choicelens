"use client";

import { useEffect, useRef, useState } from "react";
import type { ReceiptStatus } from "@/lib/genlayer";

const POLL_MS = 4000;
const MAX_TOTAL_MS = 5 * 60 * 1000;
const TERMINAL: ReadonlySet<ReceiptStatus> = new Set([
  "finalized",
  "finalized_with_error",
  "failed",
  "off_chain_only",
]);

export interface PolledReceipt {
  status: ReceiptStatus;
  [k: string]: unknown;
}

export interface UseReceiptPollingResult<T extends PolledReceipt> {
  receipt: T | null;
  error: string | null;
}

export function useReceiptPolling<T extends PolledReceipt>(
  comparisonId: string | null,
  fetcher: (id: string) => Promise<T>,
  restartKey: number = 0,
): UseReceiptPollingResult<T> {
  const [receipt, setReceipt] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!comparisonId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    startedAtRef.current = Date.now();
    let isFirstTick = true;

    const tick = async () => {
      try {
        const next = await fetcher(comparisonId);
        if (cancelled) return;
        if (isFirstTick) {
          isFirstTick = false;
          setError(null);
        }
        setReceipt(next);
        if (TERMINAL.has(next.status)) return;
        if (Date.now() - (startedAtRef.current ?? 0) > MAX_TOTAL_MS) {
          setError("transaction_timeout");
          return;
        }
        timer = setTimeout(tick, POLL_MS);
      } catch {
        if (!cancelled) setError("rpc_error");
      }
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [comparisonId, fetcher, restartKey]);

  return { receipt, error };
}
