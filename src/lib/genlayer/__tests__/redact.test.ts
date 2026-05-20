import { describe, it, expect } from "vitest";
import { redactAddress, summariseServiceKey } from "../redact";

describe("redactAddress", () => {
  it("returns null for empty input", () => {
    expect(redactAddress(null)).toBeNull();
    expect(redactAddress(undefined)).toBeNull();
    expect(redactAddress("")).toBeNull();
  });

  it("redacts a 0x-style address to first 6 + last 4", () => {
    expect(redactAddress("0xD7E2910DBbCb701992591b4285985a3Ad0e0A418")).toBe(
      "0xD7E2…A418",
    );
  });

  it("returns short strings unchanged", () => {
    expect(redactAddress("0xabc")).toBe("0xabc");
  });
});

describe("summariseServiceKey", () => {
  it("absent when missing", () => {
    expect(summariseServiceKey(undefined)).toEqual({ present: false, formatValid: false });
    expect(summariseServiceKey(null)).toEqual({ present: false, formatValid: false });
    expect(summariseServiceKey("")).toEqual({ present: false, formatValid: false });
  });

  it("present + valid for canonical 32-byte hex", () => {
    const key = "0x" + "a".repeat(64);
    expect(summariseServiceKey(key)).toEqual({ present: true, formatValid: true });
  });

  it("present + invalid format when not 0x32-byte hex", () => {
    expect(summariseServiceKey("not-a-key")).toEqual({ present: true, formatValid: false });
    expect(summariseServiceKey("0xabc")).toEqual({ present: true, formatValid: false });
  });

  it("never returns the key value", () => {
    const key = "0x" + "f".repeat(64);
    const out = summariseServiceKey(key);
    expect(JSON.stringify(out)).not.toContain(key);
  });
});
