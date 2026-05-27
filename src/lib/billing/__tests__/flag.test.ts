import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isBillingEnabled } from "../flag";

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isBillingEnabled", () => {
  it("returns true when BILLING_ENABLED is unset (default)", () => {
    vi.stubEnv("BILLING_ENABLED", "");
    expect(isBillingEnabled()).toBe(true);
  });

  it("returns true when BILLING_ENABLED=true", () => {
    vi.stubEnv("BILLING_ENABLED", "true");
    expect(isBillingEnabled()).toBe(true);
  });

  it("returns false when BILLING_ENABLED=false", () => {
    vi.stubEnv("BILLING_ENABLED", "false");
    expect(isBillingEnabled()).toBe(false);
  });

  it("returns false when BILLING_ENABLED=0", () => {
    vi.stubEnv("BILLING_ENABLED", "0");
    expect(isBillingEnabled()).toBe(false);
  });

  it("returns false when BILLING_ENABLED=off", () => {
    vi.stubEnv("BILLING_ENABLED", "off");
    expect(isBillingEnabled()).toBe(false);
  });

  it("trims and lowercases the env value", () => {
    vi.stubEnv("BILLING_ENABLED", "  FALSE  ");
    expect(isBillingEnabled()).toBe(false);
  });
});
