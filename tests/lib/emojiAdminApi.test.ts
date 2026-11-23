import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestToken = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/ircClient", () => ({ default: { requestToken } }));
vi.mock("../../src/lib/authToken", () => ({
  waitForAuthToken: vi.fn(async () => "minted"),
}));

import { deletePack, listPacks } from "../../src/lib/emojiAdminApi";

describe("emoji admin api base", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    requestToken.mockClear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends nothing without a base", async () => {
    await expect(listPacks("srv", "")).rejects.toThrow();
    await expect(deletePack("srv", "", "p")).rejects.toThrow();
    expect(requestToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the bearer to an https base", async () => {
    fetchMock.mockResolvedValue(
      new Response("[]", { status: 200, headers: { "content-type": "json" } }),
    );
    await expect(listPacks("srv", "https://api.example.org/")).resolves.toEqual(
      [],
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.org/emoji/admin/packs",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer minted" }),
      }),
    );
  });
});
