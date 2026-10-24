import { describe, expect, test, vi } from "vitest";
import ircClient from "../../../src/lib/ircClient";

describe("METADATA SUB", () => {
  test("subscribes to every key in one command", () => {
    const sendRaw = vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});
    ircClient.metadataSub("srv", ["avatar", "status", "display-name"]);
    expect(sendRaw.mock.calls).toEqual([
      ["srv", "METADATA * SUB avatar status display-name"],
    ]);
  });
});
