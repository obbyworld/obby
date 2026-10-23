import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SystemMessage } from "../../src/components/message/SystemMessage";
import {
  HISTORY_GAP_CODE,
  LOCAL_HISTORY_TAG,
} from "../../src/lib/history/historyLines";
import type { Message } from "../../src/types";

const systemMessage = (overrides: Partial<Message>): Message => ({
  id: "sys-1",
  type: "system",
  content: "",
  timestamp: new Date("2024-01-01T12:00:00Z"),
  userId: "",
  channelId: "chan-1",
  serverId: "srv",
  reactions: [],
  replyMessage: null,
  mentioned: [],
  ...overrides,
});

describe("SystemMessage", () => {
  it("renders the translated gap divider from its tag code", () => {
    render(
      <SystemMessage
        message={systemMessage({
          tags: { [LOCAL_HISTORY_TAG]: HISTORY_GAP_CODE },
        })}
      />,
    );

    expect(
      screen.getByText("Messages from this time may be missing"),
    ).toBeInTheDocument();
  });

  it("renders the content of other system messages", () => {
    render(<SystemMessage message={systemMessage({ content: "Topic set" })} />);

    expect(screen.getByText("Topic set")).toBeInTheDocument();
    expect(
      screen.queryByText("Messages from this time may be missing"),
    ).not.toBeInTheDocument();
  });
});
