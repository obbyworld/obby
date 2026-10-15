import { describe, expect, it } from "vitest";
import {
  historyPollConfigFor,
  type LiveServerState,
  needsHistoryPoll,
} from "../../../src/lib/historyPoll/historyPollConfig";
import useStore from "../../../src/store";
import type { Server, ServerConfig } from "../../../src/types";

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

const live = (overrides: Partial<LiveServerState> = {}): LiveServerState => ({
  nickOf: () => undefined,
  offersCapability: () => false,
  ...overrides,
});

describe("history poll config", () => {
  it("only polls servers that keep messages for us and have no web push", () => {
    const noPush = live().offersCapability;
    expect(
      needsHistoryPoll(server({ persistenceEffective: "ON" }), noPush),
    ).toBe(true);
    expect(needsHistoryPoll(server({ bouncerNetid: "7" }), noPush)).toBe(true);
    expect(
      needsHistoryPoll(server({ persistenceEffective: "OFF" }), noPush),
    ).toBe(false);
    expect(
      needsHistoryPoll(
        server({ isBouncerControl: true, bouncerNetid: "7" }),
        noPush,
      ),
    ).toBe(false);
    expect(
      needsHistoryPoll(
        server({ bouncerNetid: "7" }),
        (_, cap) => cap === "soju.im/webpush",
      ),
    ).toBe(false);
  });

  it("carries the address, login and mention words for each such server", () => {
    const config = historyPollConfigFor(
      [
        server({ persistenceEffective: "ON" }),
        server({ id: "plain", persistenceEffective: "OFF" }),
      ],
      [saved({}), saved({ id: "plain" })],
      settings(),
      live({ nickOf: () => "max_" }),
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
    const config = historyPollConfigFor(
      [server({ persistenceEffective: "ON" })],
      [saved({ host: "wss://irc.example.com", port: 443 })],
      settings(),
      live(),
      0,
    );
    expect(config?.servers[0].address).toBe("wss://irc.example.com");
    expect(config?.servers[0].nick).toBe("max");
  });

  it("logs a soju network in with its bouncer's saved login", () => {
    const config = historyPollConfigFor(
      [server({ id: "child", bouncerServerId: "s1", bouncerNetid: "7" })],
      [saved({ saslAccountName: "", host: "ws://bnc.example.com" })],
      settings(),
      live(),
      0,
    );
    expect(config?.servers[0]).toEqual(
      expect.objectContaining({
        id: "child",
        bouncerNetid: "7",
        account: "max",
        address: "wss://bnc.example.com:6697",
      }),
    );
  });

  it("turns off while notifications are off or the bell is muted", () => {
    const servers = [server({ persistenceEffective: "ON" })];
    expect(
      historyPollConfigFor(
        servers,
        [saved({})],
        { ...settings(), enableNotifications: false },
        live(),
        0,
      ),
    ).toBeNull();
    expect(
      historyPollConfigFor(
        servers,
        [saved({})],
        { ...settings(), notificationVolume: 0 },
        live(),
        0,
      ),
    ).toBeNull();
  });
});
