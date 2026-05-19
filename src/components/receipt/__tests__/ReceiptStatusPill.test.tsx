import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ReceiptStatusPill } from "../ReceiptStatusPill";

const STATUSES = [
  ["off_chain_only", "Off-chain"],
  ["pending", "Pending"],
  ["accepted", "Accepted"],
  ["finalized", "Finalized"],
  ["finalized_with_error", "Finalized (error)"],
  ["failed", "Failed"],
] as const;

describe("ReceiptStatusPill", () => {
  it.each(STATUSES)("renders %s as %s", (status, label) => {
    const { getByText } = render(<ReceiptStatusPill status={status as never} />);
    expect(getByText(label)).toBeTruthy();
  });
});
