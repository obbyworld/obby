import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import { clearPacedRequests } from "../../src/store/pacedRequests";

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
    vi.useFakeTimers();
    vi.restoreAllMocks();
    vi.spyOn(ircClient, "hasCapability").mockReturnValue(true);
    persistenceGet = vi
      .spyOn(ircClient, "persistenceGet")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    for (const id of ["guest", "sasl", "late"]) clearPacedRequests(id);
    vi.useRealTimers();
  });

  it("asks nothing while the connection is not logged in", () => {
    seed("guest");
    ready("guest");
    vi.runAllTimers();
    expect(persistenceGet).not.toHaveBeenCalled();
  });

  it("asks once registration is done when the login came first", () => {
    seed("sasl");
    ircClient.triggerEvent("LOGGED_IN", { serverId: "sasl", account: "me" });
    vi.runAllTimers();
    expect(persistenceGet).not.toHaveBeenCalled();
    ready("sasl");
    vi.runAllTimers();
    expect(persistenceGet).toHaveBeenCalledWith("sasl");
  });

  it("asks when the user logs in after the welcome", () => {
    seed("late");
    ready("late");
    ircClient.triggerEvent("LOGGED_IN", { serverId: "late", account: "me" });
    vi.runAllTimers();
    expect(persistenceGet).toHaveBeenCalledTimes(1);
  });
});
