import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const useAccountMock = vi.fn();
const useChainIdMock = vi.fn();
const signMessageAsyncMock = vi.fn();

vi.mock("@rainbow-me/rainbowkit", () => ({
  ConnectButton: () => <button type="button">mock connect</button>,
}));

vi.mock("wagmi", () => ({
  useAccount: () => useAccountMock(),
  useChainId: () => useChainIdMock(),
  useSignMessage: () => ({ signMessageAsync: signMessageAsyncMock }),
}));

vi.mock("siwe", () => ({
  SiweMessage: vi.fn().mockImplementation((args) => ({
    prepareMessage: () => `siwe:${JSON.stringify(args)}`,
  })),
}));

const isWalletConfiguredMock = vi.hoisted(() => ({ value: true }));

vi.mock("@/lib/wallet", () => ({
  get isWalletConfigured() {
    return isWalletConfiguredMock.value;
  },
}));

import { WalletSignInPrompt } from "../WalletSignInPrompt";

const fetchMock = vi.fn();

beforeEach(() => {
  isWalletConfiguredMock.value = true;
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, host: "test.local", origin: "https://test.local" },
  });
  useAccountMock.mockReturnValue({
    address: "0x0000000000000000000000000000000000000001",
    isConnected: true,
  });
  useChainIdMock.mockReturnValue(1);
  signMessageAsyncMock.mockResolvedValue("0xsignature");
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  signMessageAsyncMock.mockReset();
  vi.unstubAllGlobals();
});

describe("WalletSignInPrompt", () => {
  it("renders the unavailable copy when the wallet is not configured", () => {
    isWalletConfiguredMock.value = false;

    render(<WalletSignInPrompt />);

    expect(
      screen.getByText("Wallet sign-in is not configured in this environment."),
    ).toBeTruthy();
  });

  it("prompts to connect when the wallet is disconnected", () => {
    useAccountMock.mockReturnValue({ address: undefined, isConnected: false });

    render(<WalletSignInPrompt />);

    expect(
      screen.getByText("Connect a wallet before starting Plus checkout."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sign session/i })).toBeNull();
  });

  it("calls onSessionReady on a successful nonce + verify round-trip", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ nonce: "nonce_1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ account: { id: "user_1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const onSessionReady = vi.fn();
    render(<WalletSignInPrompt onSessionReady={onSessionReady} />);

    fireEvent.click(screen.getByRole("button", { name: /Sign session/i }));

    await waitFor(() => {
      expect(onSessionReady).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByText("Wallet session ready. Checkout can start."),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/auth/siwe/nonce",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/siwe/verify",
      expect.objectContaining({ method: "POST" }),
    );
    expect(signMessageAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("nonce_1") }),
    );
  });

  it("flips to signing_rejected when the wallet rejects the signature", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ nonce: "nonce_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    signMessageAsyncMock.mockRejectedValueOnce(
      new Error("User rejected the request."),
    );
    const onSessionReady = vi.fn();
    render(<WalletSignInPrompt onSessionReady={onSessionReady} />);

    fireEvent.click(screen.getByRole("button", { name: /Sign session/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Wallet signature was cancelled. You can try again."),
      ).toBeTruthy();
    });
    expect(onSessionReady).not.toHaveBeenCalled();
  });

  it("surfaces the verify error code when /api/auth/siwe/verify fails", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ nonce: "nonce_1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "wallet_already_linked" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      );
    const onSessionReady = vi.fn();
    render(<WalletSignInPrompt onSessionReady={onSessionReady} />);

    fireEvent.click(screen.getByRole("button", { name: /Sign session/i }));

    await waitFor(() => {
      expect(screen.getByText("wallet_already_linked")).toBeTruthy();
    });
    expect(onSessionReady).not.toHaveBeenCalled();
  });

  it("does not call /api/auth/siwe/verify if the nonce request fails", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("oops", { status: 500 }),
    );
    const onSessionReady = vi.fn();
    render(<WalletSignInPrompt onSessionReady={onSessionReady} />);

    fireEvent.click(screen.getByRole("button", { name: /Sign session/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Could not create a wallet challenge."),
      ).toBeTruthy();
    });
    expect(signMessageAsyncMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
