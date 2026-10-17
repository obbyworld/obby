import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import BotsPage from "../../../src/components/pages/BotsPage";
import useStore from "../../../src/store";
import type { PushBotInfo } from "../../../src/types";

const greeter: PushBotInfo = {
  bot_id: "bot1",
  nick: "Greeter",
  realname: "Says hello",
  scope: "server",
  transport: "gateway",
  status: "active",
  online: true,
  from_config: false,
  channels: [],
  commands: [{ name: "hello", description: "Say hello" }],
};

describe("BotsPage", () => {
  beforeEach(() => {
    useStore.setState({
      servers: [
        {
          id: "server1",
          name: "Test Server",
          host: "irc.test.com",
          port: 6667,
          channels: [],
          privateChats: [],
          isConnected: true,
          users: [],
          connectionState: "connected",
          bots: { greeter },
        },
      ],
      currentUser: null,
      ui: {
        ...useStore.getState().ui,
        page: { kind: "bots", serverId: "server1", botNick: "greeter" },
        pendingBotCommandPick: null,
      },
    });
  });

  it("requests the command pick for the bot and closes the page", () => {
    render(
      <BotsPage
        page={{ kind: "bots", serverId: "server1", botNick: "greeter" }}
      />,
    );

    fireEvent.click(screen.getByText("/hello"));

    expect(useStore.getState().ui.pendingBotCommandPick).toEqual({
      serverId: "server1",
      botNick: "Greeter",
      command: greeter.commands[0],
    });
    expect(useStore.getState().ui.page).toBeNull();
  });
});
