import { beforeEach, describe, expect, it, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";

function seed(serverId: string) {
  useStore.setState({
    servers: [
      {
        id: serverId,
        name: "test",
        host: "irc.test",
        port: 443,
        channels: [],
        privateChats: [],
        isConnected: true,
        users: [],
        capabilities: ["draft/persistence"],
      } as never,
    ],
  });
}

const ready = (serverId: string) =>
  ircClient.triggerEvent("ready", {
    serverId,
    serverName: "irc.test",
    nickname: "me",
  });

describe("persistence", () => {
  let persistenceGet: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(ircClient, "hasCapability").mockReturnValue(true);
    persistenceGet = vi
      .spyOn(ircClient, "persistenceGet")
      .mockImplementation(() => {});
  });

  it("asks nothing while the connection is not logged in", () => {
    seed("guest");
    ready("guest");
    expect(persistenceGet).not.toHaveBeenCalled();
  });

  it("asks once registration is done when the login came first", () => {
    seed("sasl");
    ircClient.triggerEvent("LOGGED_IN", { serverId: "sasl", account: "me" });
    expect(persistenceGet).not.toHaveBeenCalled();
    ready("sasl");
    expect(persistenceGet).toHaveBeenCalledWith("sasl");
  });

  it("asks when the user logs in after the welcome", () => {
    seed("late");
    ready("late");
    ircClient.triggerEvent("LOGGED_IN", { serverId: "late", account: "me" });
    expect(persistenceGet).toHaveBeenCalledTimes(1);
  });
});
