import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useReceiptPolling } from "../useReceiptPolling";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const baseReceipt = (status: string) => ({
  id: "rcpt_x",
  comparisonId: "cmp-1",
  payloadHash: "h",
  status,
  network: "studionet",
  contractAddress: "0xc",
  transactionHash: "0xtx",
  createdAt: new Date().toISOString(),
});

describe("useReceiptPolling", () => {
  it("fetches once immediately and stops on terminal status", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(baseReceipt("pending"))
      .mockResolvedValueOnce(baseReceipt("finalized"));
    const { result } = renderHook(() => useReceiptPolling("cmp-1", fetcher));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.receipt?.status).toBe("pending");

    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.receipt?.status).toBe("finalized");

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("times out after 5 minutes of non-terminal", async () => {
    const fetcher = vi.fn().mockResolvedValue(baseReceipt("pending"));
    const { result } = renderHook(() => useReceiptPolling("cmp-1", fetcher));
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 4000); });
    expect(result.current.error).toBe("transaction_timeout");
  });

  it("does nothing when comparisonId is null", async () => {
    const fetcher = vi.fn();
    renderHook(() => useReceiptPolling(null, fetcher));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("captures rpc errors", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useReceiptPolling("cmp-1", fetcher));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.error).toBe("rpc_error");
  });
});
