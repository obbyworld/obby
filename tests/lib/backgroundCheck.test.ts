import { describe, expect, it } from "vitest";
import {
  backgroundConfigFor,
  keepsHistoryForUs,
} from "../../src/lib/backgroundCheck";
import useStore from "../../src/store";
import type { Server, ServerConfig } from "../../src/types";

const server = (overrides: Partial<Server>) =>
  ({
    id: "s1",
    name: "ExampleNet",
    channels: [],
    privateChats: [],
    ...overrides,
  }) as unknown as Server;

const saved = (overrides: Partial<ServerConfig>): ServerConfig => ({
  id: "s1",
  host: "ircs://irc.example.com",
  port: 6697,
  nickname: "max",
  channels: [],
  saslEnabled: true,
  saslAccountName: "max",
  saslPassword: btoa("secret"),
  ...overrides,
});

const settings = () => ({
  ...useStore.getState().globalSettings,
  enableNotifications: true,
  notificationVolume: 0.4,
  customMentions: ["stream"],
});

describe("background check config", () => {
  it("only covers servers that keep messages for us", () => {
    expect(keepsHistoryForUs(server({ persistenceEffective: "ON" }))).toBe(
      true,
    );
    expect(keepsHistoryForUs(server({ bouncerNetid: "7" }))).toBe(true);
    expect(keepsHistoryForUs(server({ persistenceEffective: "OFF" }))).toBe(
      false,
    );
    expect(
      keepsHistoryForUs(server({ isBouncerControl: true, bouncerNetid: "7" })),
    ).toBe(false);
  });

  it("carries the address, login and mention words for each such server", () => {
    const config = backgroundConfigFor(
      [
        server({ persistenceEffective: "ON" }),
        server({ id: "plain", persistenceEffective: "OFF" }),
      ],
      [saved({}), saved({ id: "plain" })],
      settings(),
      () => "max_",
      1000,
    );
    expect(config?.servers).toEqual([
      expect.objectContaining({
        id: "s1",
        address: "ircs://irc.example.com:6697",
        nick: "max_",
        account: "max",
        password: "secret",
        customMentions: ["stream"],
        since: 1000,
      }),
    ]);
    expect(config?.strings.channelTitle).toBe("{sender} in {target}");
  });

  it("keeps a WebSocket address as it is saved", () => {
    const config = backgroundConfigFor(
      [server({ persistenceEffective: "ON" })],
      [saved({ host: "wss://irc.example.com", port: 443 })],
      settings(),
      () => undefined,
      0,
    );
    expect(config?.servers[0].address).toBe("wss://irc.example.com");
    expect(config?.servers[0].nick).toBe("max");
  });

  it("turns off while notifications are off or the bell is muted", () => {
    const servers = [server({ persistenceEffective: "ON" })];
    expect(
      backgroundConfigFor(
        servers,
        [saved({})],
        { ...settings(), enableNotifications: false },
        () => undefined,
        0,
      ),
    ).toBeNull();
    expect(
      backgroundConfigFor(
        servers,
        [saved({})],
        { ...settings(), notificationVolume: 0 },
        () => undefined,
        0,
      ),
    ).toBeNull();
  });
});
