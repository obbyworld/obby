import { beforeEach, describe, expect, it } from "vitest";
import useStore from "../../src/store";

describe("leaving a page", () => {
  beforeEach(() => {
    useStore.getState().openPage({ kind: "settings" });
  });

  it("closes the page when the user picks a chat", () => {
    useStore.getState().selectChannel("chan-1", { navigate: true });
    expect(useStore.getState().ui.page).toBeNull();
  });

  it("keeps the page when a chat is selected in the background", () => {
    useStore.getState().selectChannel("chan-1");
    expect(useStore.getState().ui.page).toEqual({ kind: "settings" });
  });

  it("closes the page when a profile opens", () => {
    useStore.getState().openProfile("server-1", "alice");
    expect(useStore.getState().ui.page).toBeNull();
    expect(useStore.getState().ui.profilePane).toEqual({
      serverId: "server-1",
      username: "alice",
    });
  });
});
