import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ReceiptCard, type ReceiptCardData } from "../ReceiptCard";

const BASE_RECEIPT: ReceiptCardData = {
  id: "rcpt_test01",
  payloadHash: "deadbeef",
  status: "finalized",
  network: "studionet",
  contractAddress: "0xD7E2910DBbCb701992591b4285985a3Ad0e0A418",
  transactionHash: "0xabc",
  createdAt: "2026-05-21T08:00:00.000Z",
};

describe("ReceiptCard CopyButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not error if unmounted while copied state is active", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(
      <ReceiptCard receipt={BASE_RECEIPT} pollingError={null} />,
    );
    const btn = screen.getByLabelText(/copy receipt id/i);
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("rapid clicks do not stack timers", async () => {
    render(<ReceiptCard receipt={BASE_RECEIPT} pollingError={null} />);
    const btn = screen.getByLabelText(/copy receipt id/i);
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      vi.advanceTimersByTime(500);
      fireEvent.click(btn);
      await Promise.resolve();
    });
    expect(screen.getByLabelText(/receipt id copied/i)).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1499);
    });
    expect(screen.getByLabelText(/receipt id copied/i)).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.getByLabelText(/^copy receipt id$/i)).toBeTruthy();
  });
});
