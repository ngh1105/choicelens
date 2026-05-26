import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/visitor", () => ({
  getOrCreateVisitorUser: vi.fn(),
  visitorJson: (
    _visitor: unknown,
    body: unknown,
    init?: { status?: number },
  ) =>
    new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { "content-type": "application/json" },
    }),
}));

vi.mock("@/lib/auth/siwe", () => ({
  createSiweNonce: vi.fn(),
}));

import { POST } from "../route";
import { getOrCreateVisitorUser } from "@/lib/visitor";
import { createSiweNonce } from "@/lib/auth/siwe";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOrCreateVisitorUser).mockResolvedValue({
    id: "user_1",
    plan: "free",
    visitorId: "v_1",
    shouldSetCookie: false,
  } as never);
  vi.mocked(createSiweNonce).mockResolvedValue("nonce_abc");
});

describe("POST /api/auth/siwe/nonce", () => {
  it("issues a nonce tied to the current visitor user", async () => {
    const res = await POST(new Request("http://test/api/auth/siwe/nonce"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ nonce: "nonce_abc" });
    expect(createSiweNonce).toHaveBeenCalledWith("user_1");
  });

  it("returns 500 when visitor lookup fails", async () => {
    vi.mocked(getOrCreateVisitorUser).mockRejectedValue(new Error("db"));

    const res = await POST(new Request("http://test/api/auth/siwe/nonce"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(createSiweNonce).not.toHaveBeenCalled();
  });
});
