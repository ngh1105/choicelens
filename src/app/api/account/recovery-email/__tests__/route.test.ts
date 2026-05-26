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
import { updateRecoveryEmail } from "@/lib/account";

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
});
