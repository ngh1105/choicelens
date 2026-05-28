import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { RecoveryEmailForm } from "../RecoveryEmailForm";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function emailInput(): HTMLInputElement {
  return screen.getByPlaceholderText("name@example.com") as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /Save recovery email|Saving/ }) as HTMLButtonElement;
}

describe("RecoveryEmailForm", () => {
  it("hydrates the input from the initial email and trims whitespace on submit", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ recoveryEmail: "name@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const onSaved = vi.fn();
    render(
      <RecoveryEmailForm
        initialEmail="name@example.com"
        onSaved={onSaved}
      />,
    );

    expect(emailInput().value).toBe("name@example.com");

    fireEvent.change(emailInput(), { target: { value: "  name@example.com  " } });
    fireEvent.submit(saveButton().form!);

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({
        recoveryEmail: "name@example.com",
        recoveryEmailVerifiedAt: null,
      });
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string,
    );
    expect(body).toEqual({ recoveryEmail: "name@example.com" });
    expect(screen.getByText("Recovery email saved.")).toBeTruthy();
  });

  it("posts null when the input is empty (clearing the recovery email)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ recoveryEmail: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const onSaved = vi.fn();
    render(<RecoveryEmailForm initialEmail={null} onSaved={onSaved} />);

    fireEvent.submit(saveButton().form!);

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({
        recoveryEmail: null,
        recoveryEmailVerifiedAt: null,
      });
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string,
    );
    expect(body).toEqual({ recoveryEmail: null });
  });

  it("shows friendly copy when validation fails", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "recovery_email_invalid" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    const onSaved = vi.fn();
    render(<RecoveryEmailForm initialEmail={null} onSaved={onSaved} />);
    fireEvent.change(emailInput(), { target: { value: "not-an-email" } });

    fireEvent.submit(saveButton().form!);

    await waitFor(() => {
      expect(screen.getByText("Enter a valid recovery email address.")).toBeTruthy();
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows friendly copy when recovery email is already used", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "recovery_email_already_used" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    const onSaved = vi.fn();
    render(<RecoveryEmailForm initialEmail={null} onSaved={onSaved} />);
    fireEvent.change(emailInput(), { target: { value: "name@example.com" } });

    fireEvent.submit(saveButton().form!);

    await waitFor(() => {
      expect(
        screen.getByText("This recovery email is already used by another account."),
      ).toBeTruthy();
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("falls back to the static error copy when the response has no error code", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    const onSaved = vi.fn();
    render(<RecoveryEmailForm initialEmail={null} onSaved={onSaved} />);
    fireEvent.change(emailInput(), { target: { value: "name@example.com" } });

    fireEvent.submit(saveButton().form!);

    await waitFor(() => {
      expect(
        screen.getByText("Recovery email could not be saved."),
      ).toBeTruthy();
    });
  });
});
