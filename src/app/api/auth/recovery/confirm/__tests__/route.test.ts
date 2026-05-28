import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/recovery", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/recovery")>(
    "@/lib/auth/recovery",
  );
  return {
    ...actual,
    confirmRecovery: vi.fn(),
  };
});

vi.mock("@/lib/auth/walletSession", () => ({
  applyWalletSessionCookie: <T,>(response: T) => response,
  createWalletSessionToken: () => "session_token",
  WALLET_SESSION_COOKIE_NAME: "cl_wallet_session",
}));

import { POST } from "../route";
import { confirmRecovery, RecoveryError } from "@/lib/auth/recovery";
import { SiweAuthError } from "@/lib/auth/siwe";
import { VISITOR_COOKIE_NAME } from "@/lib/visitor";

function jsonRequest(body: unknown): Request {
  return new Request("http://test/api/auth/recovery/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(confirmRecovery).mockResolvedValue({
    userId: "user_1",
    walletAddress: "0xnew",
    recoveryLockedUntil: "2026-05-29T00:00:00Z",
  });
});

describe("POST /api/auth/recovery/confirm", () => {
  it("returns the new wallet and clears the visitor cookie", async () => {
    const res = await POST(
      jsonRequest({ recoveryToken: "tok", message: "m", signature: "s" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      walletAddress: "0xnew",
      recoveryLockedUntil: "2026-05-29T00:00:00Z",
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${VISITOR_COOKIE_NAME}=`);
    expect(setCookie).toContain("Max-Age=0");
  });

  it("maps SiweAuthError to 400", async () => {
    vi.mocked(confirmRecovery).mockRejectedValue(
      new SiweAuthError("siwe_rejected", "no"),
    );
    const res = await POST(
      jsonRequest({ recoveryToken: "tok", message: "m", signature: "s" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "siwe_rejected" });
  });

  it("maps wallet_already_linked to 409", async () => {
    vi.mocked(confirmRecovery).mockRejectedValue(
      new RecoveryError("wallet_already_linked", "no"),
    );
    const res = await POST(
      jsonRequest({ recoveryToken: "tok", message: "m", signature: "s" }),
    );
    expect(res.status).toBe(409);
  });

  it("maps recovery_locked to 423", async () => {
    vi.mocked(confirmRecovery).mockRejectedValue(
      new RecoveryError("recovery_locked", "no"),
    );
    const res = await POST(
      jsonRequest({ recoveryToken: "tok", message: "m", signature: "s" }),
    );
    expect(res.status).toBe(423);
  });

  it("rejects malformed JSON", async () => {
    const res = await POST(
      new Request("http://test/api/auth/recovery/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });
});
