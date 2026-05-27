import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PrimaryWalletPanel } from "../PrimaryWalletPanel";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const CURRENT = "0x0000000000000000000000000000000000000001";
const NEXT = "0x0000000000000000000000000000000000000002";

function nextWalletInput(): HTMLInputElement {
  return screen.getByPlaceholderText("0x...") as HTMLInputElement;
}

function confirmCheckbox(): HTMLInputElement {
  return screen.getByRole("checkbox") as HTMLInputElement;
}

function requestButton(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: /Request wallet change|Requesting/,
  }) as HTMLButtonElement;
}

describe("PrimaryWalletPanel", () => {
  it("disables the form when no wallet is linked yet", () => {
    render(<PrimaryWalletPanel walletAddress={null} />);

    expect(nextWalletInput().disabled).toBe(true);
    expect(confirmCheckbox().disabled).toBe(true);
    expect(requestButton().disabled).toBe(true);
    expect(
      screen.getByText(
        "Sign in from pricing to link a wallet before requesting changes.",
      ),
    ).toBeTruthy();
  });

  it("keeps Request disabled until a wallet address is entered, even when checked", () => {
    render(<PrimaryWalletPanel walletAddress={CURRENT} />);

    fireEvent.click(confirmCheckbox());
    expect(requestButton().disabled).toBe(true);

    fireEvent.change(nextWalletInput(), { target: { value: NEXT } });
    expect(requestButton().disabled).toBe(false);
  });

  it("blocks submit and surfaces a confirm error when the checkbox is not checked", async () => {
    render(<PrimaryWalletPanel walletAddress={CURRENT} />);
    fireEvent.change(nextWalletInput(), { target: { value: NEXT } });

    // Bypass the disabled gate by submitting the form directly.
    fireEvent.submit(requestButton().form!);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Confirm that this replaces the current primary wallet.",
        ),
      ).toBeTruthy();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the trimmed requested wallet on success and shows the confirmation hint", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "req_1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<PrimaryWalletPanel walletAddress={CURRENT} />);
    fireEvent.change(nextWalletInput(), { target: { value: `  ${NEXT}  ` } });
    fireEvent.click(confirmCheckbox());

    fireEvent.submit(requestButton().form!);

    await waitFor(() => {
      expect(
        screen.getByText(/Wallet change request recorded/),
      ).toBeTruthy();
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string,
    );
    expect(body).toEqual({ requestedWalletAddress: NEXT });
    // After a successful request the form clears for the next attempt.
    expect(nextWalletInput().value).toBe("");
    expect(confirmCheckbox().checked).toBe(false);
  });

  it("surfaces the API error code when wallet_already_linked is returned", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "wallet_already_linked" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<PrimaryWalletPanel walletAddress={CURRENT} />);
    fireEvent.change(nextWalletInput(), { target: { value: NEXT } });
    fireEvent.click(confirmCheckbox());

    fireEvent.submit(requestButton().form!);

    await waitFor(() => {
      expect(screen.getByText("wallet_already_linked")).toBeTruthy();
    });
  });

  it("falls back to the static error copy when the response has no error code", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<PrimaryWalletPanel walletAddress={CURRENT} />);
    fireEvent.change(nextWalletInput(), { target: { value: NEXT } });
    fireEvent.click(confirmCheckbox());

    fireEvent.submit(requestButton().form!);

    await waitFor(() => {
      expect(
        screen.getByText("Wallet change request is not available yet."),
      ).toBeTruthy();
    });
  });
});
