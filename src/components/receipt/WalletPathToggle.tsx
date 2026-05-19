"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "choicelens.walletPathOn";

function readPersisted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writePersisted(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    window.dispatchEvent(new Event("walletPathToggle:change"));
  } catch {
    // ignore quota / privacy-mode failures
  }
}

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = () => cb();
  window.addEventListener("storage", onStorage);
  window.addEventListener("walletPathToggle:change", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("walletPathToggle:change", onStorage);
  };
}

function getServerSnapshot(): boolean {
  return false;
}

interface WalletPathToggleProps {
  disabled?: boolean;
  onChange?: (next: boolean) => void;
}

export function useWalletPathPreference(): boolean {
  return useSyncExternalStore(subscribe, readPersisted, getServerSnapshot);
}

export function WalletPathToggle({
  disabled,
  onChange,
}: WalletPathToggleProps) {
  const on = useSyncExternalStore(subscribe, readPersisted, getServerSnapshot);

  function toggle() {
    if (disabled) return;
    const next = !on;
    writePersisted(next);
    onChange?.(next);
  }

  return (
    <label className="wallet-path-toggle">
      <input
        type="checkbox"
        checked={on}
        onChange={toggle}
        disabled={disabled}
        aria-label="Sign receipt with my wallet instead of the service account"
      />
      <span>Sign with wallet</span>
    </label>
  );
}

export function readWalletPathPreference(): boolean {
  return readPersisted();
}
