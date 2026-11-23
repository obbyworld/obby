import { beforeEach, describe, expect, it } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import type { Server } from "../../src/types";

const SID = "authtoken-srv";

const server: Server = {
  id: SID,
  name: "TokenNet",
  host: "irc.example.org",
  port: 6697,
  isConnected: true,
  isRegistered: true,
  channels: [],
  privateChats: [],
  users: [],
};

const stored = () => useStore.getState().servers.find((s) => s.id === SID);

const mint = (url: string) =>
  ircClient.triggerEvent("TOKEN_GENERATE", {
    serverId: SID,
    service: "filehost",
    url,
    token: "minted",
  });

describe("draft/authtoken service url", () => {
  beforeEach(() => {
    useStore.setState({ servers: [{ ...server }] });
  });

  it.each([
    "file:///etc/passwd",
    "tauri://localhost/upload",
    "javascript:alert(1)",
    "https://user:pass@files.example.org",
    "http://files.example.org",
  ])("drops the url %s and keeps the token", (url) => {
    mint(url);
    expect(stored()?.authTokenUrl).toBeUndefined();
    expect(stored()?.authToken).toBe("minted");
  });

  it("keeps an https url", () => {
    mint("https://api.example.org");
    expect(stored()?.authTokenUrl).toBe("https://api.example.org");
  });
});
