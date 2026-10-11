import { beforeEach, describe, expect, test } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import { registerMetadataHandlers } from "../../src/store/handlers/metadata";
import * as storage from "../../src/store/localStorage";

const sent = (line: string) =>
  (
    ircClient as unknown as {
      triggerEvent(name: string, payload: unknown): void;
    }
  ).triggerEvent("rawLine", { serverId: "s1", direction: "tx", line });

describe("own metadata kept across launches", () => {
  beforeEach(() => {
    const items = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => items.set(key, value),
        removeItem: (key: string) => items.delete(key),
        clear: () => items.clear(),
      },
      writable: true,
    });
    registerMetadataHandlers(useStore);
  });

  test("keeps what we set and forgets what we clear", () => {
    sent("METADATA * SET display-name :Droid Display");
    sent("METADATA * SET status :away for lunch");
    sent("METADATA * SET status");
    expect(storage.ownMetadata.load()).toEqual({
      s1: { "display-name": "Droid Display" },
    });
  });

  test("ignores metadata set on other targets", () => {
    sent("METADATA #chan SET avatar :https://x.example/a.png");
    expect(storage.ownMetadata.load()).toEqual({});
  });
});
