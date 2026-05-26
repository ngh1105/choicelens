import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/auth/WalletSignInPrompt", () => ({
  WalletSignInPrompt: ({ onSessionReady }: { onSessionReady?: () => void }) => (
    <button
      type="button"
      data-testid="mock-sign-session"
      onClick={() => onSessionReady?.()}
    >
      mock sign session
    </button>
  ),
}));

import { PricingPlans } from "../PricingPlans";

const fetchMock = vi.fn();
const assignMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign: assignMock },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  assignMock.mockReset();
});

function findUpgradeButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /Upgrade to Plus/i }) as HTMLButtonElement;
}

describe("PricingPlans", () => {
  it("disables Upgrade to Plus until the wallet session is ready", () => {
    render(<PricingPlans />);

    expect(findUpgradeButton().disabled).toBe(true);
  });

  it("enables Upgrade to Plus once WalletSignInPrompt reports a ready session", () => {
    render(<PricingPlans />);

    fireEvent.click(screen.getByTestId("mock-sign-session"));

    expect(findUpgradeButton().disabled).toBe(false);
  });

  it("redirects to the Stripe url returned by /api/billing/checkout on success", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ url: "https://stripe.test/session_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<PricingPlans />);
    fireEvent.click(screen.getByTestId("mock-sign-session"));

    fireEvent.click(findUpgradeButton());

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith("https://stripe.test/session_123");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/billing/checkout",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces the checkout error code when the API rejects the request", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "wallet_session_required" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<PricingPlans />);
    fireEvent.click(screen.getByTestId("mock-sign-session"));

    fireEvent.click(findUpgradeButton());

    await waitFor(() => {
      expect(screen.getByText("wallet_session_required")).toBeTruthy();
    });
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("surfaces a fallback error when the checkout response has no url and no error code", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<PricingPlans />);
    fireEvent.click(screen.getByTestId("mock-sign-session"));

    fireEvent.click(findUpgradeButton());

    await waitFor(() => {
      expect(screen.getByText("Plus checkout is not available yet.")).toBeTruthy();
    });
  });

  it("keeps the Pro tile catalog-only and not self-serve", () => {
    render(<PricingPlans />);

    const proButton = screen.getByRole("button", {
      name: /Not self-serve yet/i,
    }) as HTMLButtonElement;
    expect(proButton.disabled).toBe(true);
  });
});
