import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { requireAdminToken, AdminAuthError, isAdminAuthError } from "../auth";

const ORIGINAL_ENV = { ...process.env };

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/x", { headers });
}

describe("requireAdminToken", () => {
  beforeEach(() => {
    delete process.env.ADMIN_API_TOKEN;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("throws admin_token_not_configured when env unset", () => {
    try {
      requireAdminToken(makeRequest({ authorization: "Bearer x" }));
      expect.fail("should have thrown");
    } catch (err) {
      expect(isAdminAuthError(err)).toBe(true);
      expect((err as AdminAuthError).code).toBe("admin_token_not_configured");
    }
  });

  it("throws missing_token when header missing", () => {
    process.env.ADMIN_API_TOKEN = "secret-token";
    try {
      requireAdminToken(makeRequest({}));
      expect.fail("should have thrown");
    } catch (err) {
      expect(isAdminAuthError(err)).toBe(true);
      expect((err as AdminAuthError).code).toBe("missing_token");
    }
  });

  it("throws missing_token when not Bearer", () => {
    process.env.ADMIN_API_TOKEN = "secret-token";
    try {
      requireAdminToken(makeRequest({ authorization: "Basic abc" }));
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as AdminAuthError).code).toBe("missing_token");
    }
  });

  it("throws invalid_token when value differs", () => {
    process.env.ADMIN_API_TOKEN = "secret-token";
    try {
      requireAdminToken(makeRequest({ authorization: "Bearer wrong" }));
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as AdminAuthError).code).toBe("invalid_token");
    }
  });

  it("rejects case-mutated tokens (constant-time compare)", () => {
    process.env.ADMIN_API_TOKEN = "Secret-Token";
    try {
      requireAdminToken(makeRequest({ authorization: "Bearer secret-token" }));
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as AdminAuthError).code).toBe("invalid_token");
    }
  });

  it("accepts a matching token", () => {
    process.env.ADMIN_API_TOKEN = "secret-token";
    expect(() =>
      requireAdminToken(makeRequest({ authorization: "Bearer secret-token" })),
    ).not.toThrow();
  });

  it("trims whitespace around env value and around token", () => {
    process.env.ADMIN_API_TOKEN = "  secret-token  ";
    expect(() =>
      requireAdminToken(makeRequest({ authorization: "Bearer   secret-token  " })),
    ).not.toThrow();
  });
});
