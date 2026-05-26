import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/request-user", () => ({
  getRequestUser: vi.fn(),
}));

vi.mock("@/lib/account", async () => {
  const actual = await vi.importActual<typeof import("@/lib/account")>(
    "@/lib/account",
  );
  return {
    ...actual,
    updateRecoveryEmail: vi.fn(),
  };
});

import { POST } from "../route";
import { getRequestUser } from "@/lib/request-user";
import { AccountError, updateRecoveryEmail } from "@/lib/account";

const visitorUser = {
  id: "visitor_1",
  plan: "free",
  visitorId: "v_1",
  shouldSetCookie: false,
  authKind: "visitor" as const,
  walletAddress: null,
};

const walletUser = {
  ...visitorUser,
  id: "user_1",
  authKind: "wallet" as const,
  walletAddress: "0x0000000000000000000000000000000000000001",
};

function request(body: unknown): Request {
  return new Request("http://test/api/account/recovery-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRequestUser).mockResolvedValue(walletUser);
  vi.mocked(updateRecoveryEmail).mockResolvedValue("name@example.com");
});

describe("POST /api/account/recovery-email", () => {
  it("requires wallet session", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(visitorUser);

    const res = await POST(request({ recoveryEmail: "name@example.com" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "wallet_session_required" });
    expect(updateRecoveryEmail).not.toHaveBeenCalled();
  });

  it("updates recovery email for wallet sessions", async () => {
    const res = await POST(request({ recoveryEmail: "name@example.com" }));

    expect(res.status).toBe(200);
    expect(updateRecoveryEmail).toHaveBeenCalledWith(
      "user_1",
      "name@example.com",
    );
    expect(await res.json()).toEqual({ recoveryEmail: "name@example.com" });
  });

  it("returns 500 internal_error when getRequestUser throws", async () => {
    vi.mocked(getRequestUser).mockRejectedValueOnce(new Error("db down"));

    const res = await POST(request({ recoveryEmail: "name@example.com" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(updateRecoveryEmail).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON bodies", async () => {
    const res = await POST(
      new Request("http://test/api/account/recovery-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
    expect(updateRecoveryEmail).not.toHaveBeenCalled();
  });

  it("maps recovery_email_invalid AccountError to 400 with the code", async () => {
    vi.mocked(updateRecoveryEmail).mockRejectedValueOnce(
      new AccountError("recovery_email_invalid", "Invalid email."),
    );

    const res = await POST(request({ recoveryEmail: "not-an-email" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "recovery_email_invalid" });
  });

  it("returns 500 internal_error for unexpected updateRecoveryEmail failures", async () => {
    vi.mocked(updateRecoveryEmail).mockRejectedValueOnce(new Error("boom"));

    const res = await POST(request({ recoveryEmail: "name@example.com" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
  });

  it("forwards undefined for non-object payloads (clears recovery email)", async () => {
    vi.mocked(updateRecoveryEmail).mockResolvedValueOnce(null);

    const res = await POST(
      new Request("http://test/api/account/recovery-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify("not-an-object"),
      }),
    );

    expect(res.status).toBe(200);
    expect(updateRecoveryEmail).toHaveBeenCalledWith("user_1", undefined);
    expect(await res.json()).toEqual({ recoveryEmail: null });
  });
});
