import { beforeEach, describe, expect, test, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import {
  registerMetadataHandlers,
  syncOwnMetadata,
} from "../../src/store/handlers/metadata";
import * as storage from "../../src/store/localStorage";

const emit = (name: string, payload: unknown) =>
  (
    ircClient as unknown as {
      triggerEvent(name: string, payload: unknown): void;
    }
  ).triggerEvent(name, payload);
const sent = (line: string) =>
  emit("rawLine", { serverId: "s1", direction: "tx", line });
const onServer = (values: Record<string, string>) =>
  storage.metadata.save({
    s1: {
      droid: Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          { value, visibility: "*" },
        ]),
      ),
    },
  });

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
    vi.spyOn(ircClient, "getNick").mockReturnValue("droid");
    storage.metadata.save({});
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

  test("follows a change another of our clients made", () => {
    sent("METADATA * SET display-name :Old Name");
    emit("METADATA", {
      serverId: "s1",
      target: "droid",
      key: "display-name",
      value: "New Name",
    });
    expect(storage.ownMetadata.load().s1).toEqual({
      "display-name": "New Name",
    });
  });

  test("takes the server's copy when it still holds some of ours", () => {
    const metadataSet = vi.fn();
    useStore.setState({ metadataSet });
    sent("METADATA * SET display-name :Old Name");
    sent("METADATA * SET status :cleared elsewhere");
    onServer({ "display-name": "New Name" });
    syncOwnMetadata(useStore, "s1", ["display-name", "status"]);
    expect(storage.ownMetadata.load().s1).toEqual({
      "display-name": "New Name",
    });
    expect(metadataSet).not.toHaveBeenCalled();
  });

  test("sets ours again when the server forgot all of it", () => {
    const metadataSet = vi.fn();
    useStore.setState({ metadataSet });
    sent("METADATA * SET display-name :Droid Display");
    onServer({});
    syncOwnMetadata(useStore, "s1", ["display-name", "status"]);
    expect(metadataSet).toHaveBeenCalledWith(
      "s1",
      "*",
      "display-name",
      "Droid Display",
    );
    expect(metadataSet).toHaveBeenCalledTimes(1);
  });
});
