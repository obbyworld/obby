import { beforeEach, describe, expect, it } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";
import type { Server } from "../../src/types";

const SID = "filehost-srv";

const server: Server = {
  id: SID,
  name: "FileNet",
  host: "irc.example.org",
  port: 6697,
  isConnected: true,
  isRegistered: true,
  channels: [],
  privateChats: [],
  users: [],
};

const stored = () => useStore.getState().servers.find((s) => s.id === SID);

const advertise = (key: string, value: string) =>
  ircClient.triggerEvent("ISUPPORT", { serverId: SID, key, value });

const UNSAFE = [
  "file:///etc/passwd",
  "tauri://localhost/upload",
  "javascript:alert(1)",
  "https://user:pass@files.example.org",
  "http://files.example.org",
];

describe("server-advertised file hosts", () => {
  beforeEach(() => {
    useStore.setState({ servers: [{ ...server }] });
  });

  it.each(UNSAFE)("drops obby.world/FILEHOST %s", (value) => {
    advertise("obby.world/FILEHOST", value);
    expect(stored()?.filehost).toBeUndefined();
  });

  it("keeps an https obby.world/FILEHOST", () => {
    advertise("obby.world/FILEHOST", "https://irc.example.org");
    expect(stored()?.filehost).toBe("https://irc.example.org");
  });

  it("keeps a loopback http obby.world/FILEHOST", () => {
    advertise("obby.world/FILEHOST", "http://localhost:8090");
    expect(stored()?.filehost).toBe("http://localhost:8090");
  });

  it("takes the first safe host of a multi-host obby.world/FILEHOST", () => {
    advertise(
      "obby.world/FILEHOST",
      "file:///etc/passwd https://api.example.org https://b.example.org",
    );
    expect(stored()?.filehost).toBe("https://api.example.org");
  });

  it("clears a filehost the server replaces with an unsafe value", () => {
    advertise("obby.world/FILEHOST", "https://irc.example.org");
    advertise("obby.world/FILEHOST", "tauri://localhost");
    expect(stored()?.filehost).toBeUndefined();
  });

  it("keeps only the safe draft/FILEHOST endpoints", () => {
    advertise(
      "draft/FILEHOST",
      [...UNSAFE, "https://s.example.org/api/", "http://127.0.0.1:7790"].join(
        " ",
      ),
    );
    expect(stored()?.fileHosts).toEqual([
      "https://s.example.org/api/",
      "http://127.0.0.1:7790",
    ]);
  });
});
