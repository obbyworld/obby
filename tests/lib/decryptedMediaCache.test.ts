import { beforeEach, describe, expect, test, vi } from "vitest";

const fetchDecryptedMedia = vi.fn();

vi.mock("../../src/lib/e2ee/media", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/e2ee/media")
  >("../../src/lib/e2ee/media");
  return { ...actual, fetchDecryptedMedia };
});

const {
  clearDecryptedMediaCache,
  getDecryptedObjectUrl,
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import after the mock
} = (await import("../../src/lib/e2ee/decryptedMediaCache")) as any;

let created = 0;
const revoked: string[] = [];

const descriptor = (url: string, size = 1024) => ({
  url,
  k: "kkkk",
  n: "nnnn",
  mime: "image/png",
  name: "a.png",
  size,
});

describe("decrypted media cache", () => {
  beforeEach(() => {
    created = 0;
    revoked.length = 0;
    fetchDecryptedMedia.mockReset();
    vi.stubGlobal("URL", {
      createObjectURL: (blob: { size: number }) => {
        created += 1;
        return `blob:${created}:${blob.size}`;
      },
      revokeObjectURL: (u: string) => revoked.push(u),
    });
    clearDecryptedMediaCache();
  });

  test("the same file is decrypted once", async () => {
    fetchDecryptedMedia.mockResolvedValue({ size: 10 });
    const a = await getDecryptedObjectUrl(descriptor("https://h/1.obb"));
    const b = await getDecryptedObjectUrl(descriptor("https://h/1.obb"));
    expect(a).toBe(b);
    expect(fetchDecryptedMedia).toHaveBeenCalledTimes(1);
  });

  test("concurrent callers share one download", async () => {
    fetchDecryptedMedia.mockResolvedValue({ size: 10 });
    const [a, b] = await Promise.all([
      getDecryptedObjectUrl(descriptor("https://h/2.obb")),
      getDecryptedObjectUrl(descriptor("https://h/2.obb")),
    ]);
    expect(a).toBe(b);
    expect(fetchDecryptedMedia).toHaveBeenCalledTimes(1);
  });

  // The ciphertext URL alone is not the identity: the same bytes under another
  // key are another file.
  test("a different key is a different file", async () => {
    fetchDecryptedMedia.mockResolvedValue({ size: 10 });
    const a = await getDecryptedObjectUrl(descriptor("https://h/3.obb"));
    const b = await getDecryptedObjectUrl({
      ...descriptor("https://h/3.obb"),
      k: "other",
    });
    expect(a).not.toBe(b);
    expect(fetchDecryptedMedia).toHaveBeenCalledTimes(2);
  });

  test("a failure is not cached, so a retry can work", async () => {
    fetchDecryptedMedia.mockRejectedValueOnce(new Error("boom"));
    await expect(
      getDecryptedObjectUrl(descriptor("https://h/4.obb")),
    ).rejects.toThrow("boom");

    fetchDecryptedMedia.mockResolvedValue({ size: 10 });
    await expect(
      getDecryptedObjectUrl(descriptor("https://h/4.obb")),
    ).resolves.toMatch(/^blob:/);
    expect(fetchDecryptedMedia).toHaveBeenCalledTimes(2);
  });

  test("going over the cap revokes the oldest", async () => {
    const big = 25 * 1024 * 1024;
    fetchDecryptedMedia.mockResolvedValue({ size: big });
    const first = await getDecryptedObjectUrl(descriptor("https://h/a.obb"));
    for (const name of ["b", "c", "d", "e"]) {
      await getDecryptedObjectUrl(descriptor(`https://h/${name}.obb`));
    }
    expect(revoked).toContain(first);

    // Evicted, so it is fetched again rather than served stale.
    const callsBefore = fetchDecryptedMedia.mock.calls.length;
    await getDecryptedObjectUrl(descriptor("https://h/a.obb"));
    expect(fetchDecryptedMedia.mock.calls.length).toBe(callsBefore + 1);
  });

  test("clearing revokes every url it held", async () => {
    fetchDecryptedMedia.mockResolvedValue({ size: 10 });
    const a = await getDecryptedObjectUrl(descriptor("https://h/5.obb"));
    clearDecryptedMediaCache();
    expect(revoked).toContain(a);
  });
});
