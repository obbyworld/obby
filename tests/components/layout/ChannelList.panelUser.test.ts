import { describe, expect, test } from "vitest";
import { panelUser } from "../../../src/components/layout/ChannelList";
import type { AppState } from "../../../src/store";
import type { User } from "../../../src/types";

const user = (username: string): User => ({
  id: username,
  username,
  isOnline: true,
});

describe("panelUser", () => {
  test("shows our nick on the selected server, never another server's", () => {
    const state = {
      currentUser: user("cqdpush"),
      servers: [{ id: "s2", channels: [] }],
    } as unknown as AppState;
    expect(panelUser(state, "s2", user("max")).username).toBe("max");
  });

  test("takes our channel entry for its metadata", () => {
    const inChannel = { ...user("max"), metadata: { avatar: { value: "a" } } };
    const state = {
      currentUser: user("cqdpush"),
      servers: [{ id: "s2", channels: [{ users: [inChannel] }] }],
    } as unknown as AppState;
    expect(panelUser(state, "s2", user("max"))).toBe(inChannel);
  });
});
