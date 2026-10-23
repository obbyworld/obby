import { beforeEach, describe, expect, it, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore, {
  loadSavedServers,
  saveServersToLocalStorage,
} from "../../src/store";

const confirmNick = (oldNick: string, newNick: string) => {
  vi.spyOn(ircClient, "getNick").mockReturnValue(newNick);
  ircClient.triggerEvent("NICK", {
    serverId: "srv-1",
    mtags: undefined,
    oldNick,
    newNick,
  });
};

const savedNick = () =>
  loadSavedServers().find((s) => s.id === "srv-1")?.nickname;

describe("the saved nickname", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const stored = new Map<string, string>();
    vi.mocked(localStorage.getItem).mockImplementation(
      (key) => stored.get(key) ?? null,
    );
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      stored.set(key, value);
    });
    saveServersToLocalStorage([
      {
        id: "srv-1",
        host: "irc.example.org",
        port: 6697,
        nickname: "valware",
        channels: [],
        saslEnabled: false,
      },
    ]);
    vi.spyOn(ircClient, "changeNick").mockImplementation(() => {});
  });

  it("follows a nick change we asked for once the server confirms it", () => {
    useStore.getState().changeNick("srv-1", "Valware2");
    confirmNick("valware", "Valware2");
    expect(savedNick()).toBe("Valware2");
  });

  it("keeps a nick the server gives us on its own", () => {
    confirmNick("valware", "Guest4521");
    expect(savedNick()).toBe("valware");
  });

  it("keeps the saved nick while the server has not confirmed the change", () => {
    useStore.getState().changeNick("srv-1", "taken");
    expect(savedNick()).toBe("valware");
  });
});
