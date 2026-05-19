import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { WalletPathToggle, readWalletPathPreference } from "../WalletPathToggle";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("WalletPathToggle", () => {
  it("starts off and persists when toggled on", () => {
    const onChange = vi.fn();
    const { getByRole } = render(<WalletPathToggle onChange={onChange} />);
    const cb = getByRole("checkbox") as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(cb.checked).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(readWalletPathPreference()).toBe(true);
  });

  it("hydrates initial state from localStorage", () => {
    window.localStorage.setItem("choicelens.walletPathOn", "1");
    const { getByRole } = render(<WalletPathToggle />);
    const cb = getByRole("checkbox") as HTMLInputElement;
    // useEffect runs after mount; jsdom flushes synchronously.
    expect(cb.checked).toBe(true);
  });

  it("respects disabled prop", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <WalletPathToggle disabled onChange={onChange} />,
    );
    const cb = getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(cb);
    expect(onChange).not.toHaveBeenCalled();
    expect(cb.checked).toBe(false);
  });
});
