import { beforeEach, describe, expect, test, vi } from "vitest";

const MODULE = "../../../src/lib/e2ee/obbyIdentity";

// The global setup mocks localStorage as no-op spies; swap in a real in-memory
// store (persisting across resetModules within a test) so the cross-reload
// persistence is genuinely exercised.
beforeEach(() => {
  const data = new Map<string, string>();
  window.localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, String(v));
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  vi.resetModules();
});

describe("getObbyIdentity", () => {
  test("returns a stable identity within a session", async () => {
    const { getObbyIdentity } = await import(MODULE);
    const first = getObbyIdentity();
    expect(getObbyIdentity()).toBe(first);
    expect(first.sikPub.length).toBe(32);
    expect(first.ikPub.length).toBe(32);
  });

  test("persists across reloads — a fresh import restores the same keys", async () => {
    const first = (await import(MODULE)).getObbyIdentity();
    vi.resetModules();
    const second = (await import(MODULE)).getObbyIdentity();
    expect([...second.sikPriv]).toEqual([...first.sikPriv]);
    expect([...second.ikPriv]).toEqual([...first.ikPriv]);
  });

  test("generates a fresh identity when storage is empty", async () => {
    const first = (await import(MODULE)).getObbyIdentity();
    window.localStorage.clear();
    vi.resetModules();
    const second = (await import(MODULE)).getObbyIdentity();
    expect([...second.sikPriv]).not.toEqual([...first.sikPriv]);
  });
});
