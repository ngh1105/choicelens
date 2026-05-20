export function redactAddress(addr: string | null | undefined): string | null {
  if (!addr) return null;
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export interface ServiceKeySummary {
  present: boolean;
  formatValid: boolean;
}

export function summariseServiceKey(
  key: string | undefined | null,
): ServiceKeySummary {
  if (!key) return { present: false, formatValid: false };
  return { present: true, formatValid: /^0x[a-fA-F0-9]{64}$/.test(key) };
}
