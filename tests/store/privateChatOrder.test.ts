import { beforeEach, describe, expect, test } from "vitest";
import useStore from "../../src/store";

const serverId = "s1";

function privateChatOrders() {
  return Object.fromEntries(
    (
      useStore.getState().servers.find((s) => s.id === serverId)
        ?.privateChats ?? []
    ).map((pc) => [pc.username, pc.order]),
  );
}

describe("private chat order", () => {
  beforeEach(() => {
    useStore.setState({
      servers: [
        {
          id: serverId,
          name: "test",
          host: "irc.test",
          port: 443,
          channels: [],
          privateChats: [
            { id: "jadey", username: "jadey", isPinned: true, order: 1 },
            { id: "valware", username: "Valware" },
          ],
          isConnected: true,
          users: [],
        } as never,
      ],
    });
  });

  test("an unpinned chat keeps the place it is dragged to", () => {
    useStore.getState().reorderPrivateChats(serverId, ["valware", "jadey"]);
    expect(privateChatOrders()).toEqual({ Valware: 0, jadey: 1 });
  });
});
