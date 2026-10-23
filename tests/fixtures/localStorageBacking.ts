import { vi } from "vitest";

// tests/setup.ts mocks localStorage globally, so we back it with a real Map to let saves round trip.
export const lsBacking = new Map<string, string>();

export function installLocalStorageBacking(): void {
  lsBacking.clear();
  vi.mocked(window.localStorage.getItem).mockImplementation(
    (k: string) => lsBacking.get(k) ?? null,
  );
  vi.mocked(window.localStorage.setItem).mockImplementation(
    (k: string, v: string) => {
      lsBacking.set(k, v);
    },
  );
  vi.mocked(window.localStorage.removeItem).mockImplementation((k: string) => {
    lsBacking.delete(k);
  });
}
