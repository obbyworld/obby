import { beforeEach, describe, expect, it } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore from "../../src/store";

function setupServer() {
  useStore.setState({
    servers: [
      {
        id: "srv-1",
        name: "TestServer",
        host: "irc.example.com",
        port: 6667,
        channels: [
          {
            id: "chan-1",
            name: "#bots",
            topic: "",
            users: [
              {
                id: "Weather",
                username: "Weather",
                isOnline: true,
                isBot: true,
              },
            ],
            messages: [],
            isPrivate: false,
            serverId: "srv-1",
            unreadCount: 0,
            isMentioned: false,
            modes: "",
          },
        ],
        privateChats: [],
        isConnected: true,
        users: [],
      },
    ],
  });
}

function encodeBotCmds(commands: unknown): string {
  const json = JSON.stringify({ commands });
  return Buffer.from(json, "utf8").toString("base64");
}

describe("pushbot store handler", () => {
  beforeEach(() => {
    setupServer();
  });

  it("caches commands when TAGMSG carries +draft/bot-cmds", () => {
    ircClient.triggerEvent("TAGMSG", {
      serverId: "srv-1",
      sender: "Weather",
      channelName: "ourNick",
      mtags: {
        "+draft/bot-cmds": encodeBotCmds([
          {
            name: "forecast",
            description: "Look up the weather",
            contexts: ["public", "pm"],
          },
        ]),
      },
      timestamp: new Date(),
    });

    const server = useStore.getState().servers[0];
    expect(server.botCommands).toBeDefined();
    expect(server.botCommands?.weather).toEqual([
      {
        name: "forecast",
        description: "Look up the weather",
        contexts: ["public", "pm"],
      },
    ]);
  });

  it("invalidates the cache on +draft/bot-cmds-changed", () => {
    useStore.setState((s) => ({
      servers: s.servers.map((srv) => ({
        ...srv,
        botCommands: { weather: [{ name: "forecast" }] },
      })),
    }));

    ircClient.triggerEvent("TAGMSG", {
      serverId: "srv-1",
      sender: "Weather",
      channelName: "ourNick",
      mtags: { "+draft/bot-cmds-changed": "1" },
      timestamp: new Date(),
    });

    const server = useStore.getState().servers[0];
    expect(server.botCommands?.weather).toBeUndefined();
  });

  it("ignores TAGMSGs without bot-cmds tags", () => {
    ircClient.triggerEvent("TAGMSG", {
      serverId: "srv-1",
      sender: "Weather",
      channelName: "#general",
      mtags: { "+typing": "active" },
      timestamp: new Date(),
    });
    const server = useStore.getState().servers[0];
    expect(server.botCommands).toBeUndefined();
  });

  // ─── obby.world/channel-bots ──────────────────────────────────────

  function encodeBotInfo(info: object): string {
    return Buffer.from(JSON.stringify(info), "utf8").toString("base64");
  }

  it("populates server.bots on obby.world/bot-info 'add'", () => {
    ircClient.triggerEvent("TAGMSG", {
      serverId: "srv-1",
      sender: "obby.example.com",
      channelName: "ourNick",
      mtags: {
        "obby.world/bot-info": encodeBotInfo({
          event: "add",
          bot_id: "pb1",
          nick: "weather",
          realname: "Weather Bot",
          scope: "channel",
          transport: "gateway",
          status: "active",
          online: true,
          from_config: true,
          channels: ["#weather"],
          commands: [{ name: "forecast" }],
        }),
      },
      timestamp: new Date(),
    });
    const server = useStore.getState().servers[0];
    expect(server.bots?.weather?.nick).toBe("weather");
    expect(server.bots?.weather?.online).toBe(true);
    // also fills botCommands for the slash popover
    expect(server.botCommands?.weather?.[0]?.name).toBe("forecast");
  });

  it("removes server.bots[nick] on obby.world/bot-info 'remove'", () => {
    useStore.setState((s) => ({
      servers: s.servers.map((srv) => ({
        ...srv,
        bots: {
          weather: {
            bot_id: "pb1",
            nick: "weather",
            realname: "Weather Bot",
            scope: "channel",
            transport: "gateway",
            status: "active",
            online: true,
            from_config: true,
            channels: [],
            commands: [],
          },
        },
        botCommands: { weather: [{ name: "forecast" }] },
      })),
    }));

    ircClient.triggerEvent("TAGMSG", {
      serverId: "srv-1",
      sender: "obby.example.com",
      channelName: "ourNick",
      mtags: {
        "obby.world/bot-info": encodeBotInfo({
          event: "remove",
          nick: "weather",
          bot_id: "pb1",
          realname: "",
          scope: "channel",
          transport: "gateway",
          status: "deleted",
          online: false,
          from_config: false,
          channels: [],
          commands: [],
        }),
      },
      timestamp: new Date(),
    });
    const server = useStore.getState().servers[0];
    expect(server.bots?.weather).toBeUndefined();
    expect(server.botCommands?.weather).toBeUndefined();
  });
});
