import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
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
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it("marks the button as failed when clipboard.writeText rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        writeText: vi
          .fn()
          .mockRejectedValue(new DOMException("denied", "NotAllowedError")),
      },
    });
    render(<ReceiptCard receipt={BASE_RECEIPT} pollingError={null} />);
    const btn = screen.getByLabelText(/copy receipt id/i);
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(btn.getAttribute("data-failed")).toBe("true");
    expect(btn.getAttribute("aria-label")).toMatch(/could not copy receipt id/i);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("does not announce 'copied' when a second copy fails inside the success window", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });
    render(<ReceiptCard receipt={BASE_RECEIPT} pollingError={null} />);
    const btn = screen.getByLabelText(/copy receipt id/i);
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });
    expect(btn.getAttribute("data-copied")).toBe("true");
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(btn.getAttribute("data-copied")).not.toBe("true");
    expect(btn.getAttribute("data-failed")).toBe("true");
    expect(btn.getAttribute("aria-label")).toMatch(/could not copy receipt id/i);
    expect(errorSpy).toHaveBeenCalled();
  });
});
