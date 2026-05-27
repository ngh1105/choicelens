import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { BillingPortalButton } from "../BillingPortalButton";

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

function findManageButton(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: /Manage billing|Opening/,
  }) as HTMLButtonElement;
}

describe("BillingPortalButton", () => {
  it("renders the disabled-helper when there is no Plus subscription yet", () => {
    render(<BillingPortalButton disabled />);

    expect(findManageButton().disabled).toBe(true);
    expect(
      screen.getByText("Billing portal appears after Plus checkout."),
    ).toBeTruthy();
  });

  it("hides the helper copy and enables the button for active subscriptions", () => {
    render(<BillingPortalButton disabled={false} />);

    expect(findManageButton().disabled).toBe(false);
    expect(
      screen.queryByText("Billing portal appears after Plus checkout."),
    ).toBeNull();
  });

  it("redirects to the Stripe portal url on success", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ url: "https://stripe.test/portal" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<BillingPortalButton disabled={false} />);

    fireEvent.click(findManageButton());

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith("https://stripe.test/portal");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/billing/portal",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces the API error code when the portal fails to open", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "billing_portal_unavailable" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<BillingPortalButton disabled={false} />);

    fireEvent.click(findManageButton());

    await waitFor(() => {
      expect(screen.getByText("billing_portal_unavailable")).toBeTruthy();
    });
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("uses the static fallback copy when the response has no url and no error", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<BillingPortalButton disabled={false} />);

    fireEvent.click(findManageButton());

    await waitFor(() => {
      expect(
        screen.getByText("Billing portal is not available yet."),
      ).toBeTruthy();
    });
  });
});
