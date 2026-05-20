import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    receipt: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { GET } from "../route";
import { prisma } from "@/lib/db";

const VALID_KEY = "0x" + "a".repeat(64);
const ORIGINAL_ENV = { ...process.env };

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://test/api/admin/genlayer/health", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.receipt.findMany).mockResolvedValue([]);
  vi.mocked(prisma.receipt.count).mockResolvedValue(0);
  process.env = { ...ORIGINAL_ENV };
  delete process.env.ADMIN_API_TOKEN;
  delete process.env.GENLAYER_NETWORK;
  delete process.env.GENLAYER_CONTRACT_ADDRESS;
  delete process.env.GENLAYER_SERVICE_PRIVATE_KEY;
  delete process.env.GENLAYER_RPC_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/admin/genlayer/health", () => {
  it("returns 503 when ADMIN_API_TOKEN is not configured", async () => {
    const res = await GET(req({ authorization: "Bearer anything" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("admin_token_not_configured");
  });

  it("returns 401 without bearer token", async () => {
    process.env.ADMIN_API_TOKEN = "ops-token";
    const res = await GET(req({}));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("missing_token");
  });

  it("returns 401 with wrong bearer token", async () => {
    process.env.ADMIN_API_TOKEN = "ops-token";
    const res = await GET(req({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("invalid_token");
  });

  it("returns 200 with safe shape under correct token", async () => {
    process.env.ADMIN_API_TOKEN = "ops-token";
    process.env.GENLAYER_NETWORK = "mock";
    const res = await GET(req({ authorization: "Bearer ops-token" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operatorState).toBe("mock");
    expect(body.serviceKeyPresent).toBe(false);
    expect(body.killSwitchActive).toBe(false);
    expect(body).toHaveProperty("counts24h");
    expect(body).toHaveProperty("recentErrors");
    expect(body).toHaveProperty("checkedAt");
  });

  it("never echoes the service key value in the response", async () => {
    process.env.ADMIN_API_TOKEN = "ops-token";
    process.env.GENLAYER_NETWORK = "studionet";
    process.env.GENLAYER_CONTRACT_ADDRESS = "0xD7E2910DBbCb701992591b4285985a3Ad0e0A418";
    process.env.GENLAYER_SERVICE_PRIVATE_KEY = VALID_KEY;
    process.env.GENLAYER_RPC_URL = "https://studio.genlayer.com/api";

    const res = await GET(req({ authorization: "Bearer ops-token" }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(VALID_KEY);
    expect(text).not.toContain(VALID_KEY.slice(2));

    const body = JSON.parse(text);
    expect(body.serviceKeyPresent).toBe(true);
    expect(body.serviceKeyFormatValid).toBe(true);
    expect(body.serviceAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(body.contractAddressRedacted).toBe("0xD7E2…A418");
  });

  it("reports kill_switch_active when network=mock but prior studionet receipts exist", async () => {
    vi.mocked(prisma.receipt.count).mockResolvedValue(3);
    process.env.ADMIN_API_TOKEN = "ops-token";
    process.env.GENLAYER_NETWORK = "mock";

    const res = await GET(req({ authorization: "Bearer ops-token" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operatorState).toBe("kill_switch_active");
    expect(body.killSwitchActive).toBe(true);
  });
});
