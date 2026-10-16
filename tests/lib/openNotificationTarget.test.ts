import { describe, expect, it, vi } from "vitest";

const jump = vi.hoisted(() => ({
  jumpToMessage: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../src/lib/jumpToMessage", () => jump);

import { openNotificationTarget } from "../../src/lib/openNotificationTarget";
import useStore from "../../src/store";
import type { Server } from "../../src/types";

const serverWith = (isLoadingHistory: boolean) =>
  [
    {
      id: "s1",
      isConnected: true,
      channels: [{ name: "#dev", isLoadingHistory }],
      privateChats: [],
    },
  ] as unknown as Server[];

describe("opening a tapped notification", () => {
  it("jumps once the chat has loaded the history that holds the message", async () => {
    useStore.setState({ servers: serverWith(true) });

    const opening = openNotificationTarget({
      serverId: "s1",
      target: "#dev",
      time: 1,
      msgid: "m1",
    });
    await Promise.resolve();
    expect(jump.jumpToMessage).not.toHaveBeenCalled();

    useStore.setState({ servers: serverWith(false) });
    await opening;

    expect(jump.jumpToMessage).toHaveBeenCalledWith(
      expect.objectContaining({ msgid: "m1" }),
    );
  });

  it("jumps once the page is visible", async () => {
    useStore.setState({ servers: serverWith(false) });
    jump.jumpToMessage.mockClear();
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");

    const opening = openNotificationTarget({
      serverId: "s1",
      target: "#dev",
      time: 1,
      msgid: "m1",
    });
    await new Promise((resolve) => setTimeout(resolve));
    expect(jump.jumpToMessage).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await opening;

    expect(jump.jumpToMessage).toHaveBeenCalled();
    visibility.mockRestore();
  });
});
