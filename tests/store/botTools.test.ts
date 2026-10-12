import { beforeEach, describe, expect, test } from "vitest";
import ircClient from "../../src/lib/ircClient";
import type { AppState } from "../../src/store";
import useStore from "../../src/store";

const SID = "srv-1";
const CHAN = "#ai";
const BOT = "researchbot";

function emit(
  type: "TAGMSG" | "CHANMSG",
  payload: Record<string, unknown>,
): void {
  // biome-ignore lint/suspicious/noExplicitAny: triggerEvent is dynamically typed
  ircClient.triggerEvent(type as any, payload as any);
}

// The handler decodes base64 tag values; wrap the JSON the way the wire does.
function tag(value: string): Record<string, string> {
  return { "+draft/bot-tools": Buffer.from(value, "utf8").toString("base64") };
}

describe("botTools store handler", () => {
  beforeEach(() => {
    useStore.setState({ aiWorkflows: {} } as Partial<AppState>);
  });

  test("workflow start creates a new entry with steps:[]", () => {
    emit("TAGMSG", {
      serverId: SID,
      mtags: tag(
        '{"msg":"workflow","id":"w1","state":"start","name":"Research","trigger":"m1"}',
      ),
      sender: BOT,
      channelName: CHAN,
    });
    const wf = useStore.getState().aiWorkflows[SID]?.w1;
    expect(wf).toMatchObject({
      id: "w1",
      serverId: SID,
      senderNick: BOT,
      channel: CHAN,
      name: "Research",
      state: "start",
      trigger: "m1",
      steps: [],
      collapsed: true,
      dismissed: false,
    });
  });

  test("subsequent workflow update merges over existing state", () => {
    emit("TAGMSG", {
      serverId: SID,
      mtags: tag(
        '{"msg":"workflow","id":"w1","state":"start","name":"Research"}',
      ),
      sender: BOT,
      channelName: CHAN,
    });
    emit("TAGMSG", {
      serverId: SID,
      mtags: tag('{"msg":"workflow","id":"w1","state":"complete"}'),
      sender: BOT,
      channelName: CHAN,
    });
    const wf = useStore.getState().aiWorkflows[SID]?.w1;
    expect(wf?.state).toBe("complete");
    expect(wf?.name).toBe("Research"); // preserved from earlier
  });

  test("step start appends to the workflow's step list", () => {
    emit("TAGMSG", {
      serverId: SID,
      mtags: tag('{"msg":"workflow","id":"w1","state":"start"}'),
      sender: BOT,
      channelName: CHAN,
    });
    emit("TAGMSG", {
      serverId: SID,
      mtags: tag(
        '{"msg":"step","wid":"w1","sid":"s1","type":"tool-call","state":"start","tool":"web-search","content":{"query":"x"}}',
      ),
      sender: BOT,
      channelName: CHAN,
    });
    const steps = useStore.getState().aiWorkflows[SID]?.w1.steps;
    expect(steps).toHaveLength(1);
    expect(steps?.[0]).toMatchObject({
      sid: "s1",
      type: "tool-call",
      tool: "web-search",
      content: { query: "x" },
      state: "start",
    });
  });

  test("step update on same sid merges state without duplicating", () => {
    emit("TAGMSG", {
      serverId: SID,
      mtags: tag('{"msg":"workflow","id":"w1","state":"start"}'),
      sender: BOT,
      channelName: CHAN,
    });
    emit("TAGMSG", {
      serverId: SID,
      mtags: tag(
        '{"msg":"step","wid":"w1","sid":"s1","type":"tool-call","state":"start","tool":"web-search"}',
      ),
      sender: BOT,
      channelName: CHAN,
    });
    emit("TAGMSG", {
      serverId: SID,
      mtags: tag(
        '{"msg":"step","wid":"w1","sid":"s1","type":"tool-call","state":"complete","tool":"web-search"}',
      ),
      sender: BOT,
      channelName: CHAN,
    });
    const steps = useStore.getState().aiWorkflows[SID]?.w1.steps;
    expect(steps).toHaveLength(1);
    expect(steps?.[0].state).toBe("complete");
  });

  test("string content from sequential updates is concatenated", () => {
    emit("TAGMSG", {
      serverId: SID,
      mtags: tag('{"msg":"workflow","id":"w1","state":"start"}'),
      sender: BOT,
      channelName: CHAN,
    });
    emit("TAGMSG", {
      serverId: SID,
      mtags: tag(
        '{"msg":"step","wid":"w1","sid":"s1","type":"tool-result","state":"running","content":"hello "}',
      ),
      sender: BOT,
      channelName: CHAN,
    });
    emit("TAGMSG", {
      serverId: SID,
      mtags: tag(
        '{"msg":"step","wid":"w1","sid":"s1","type":"tool-result","state":"running","content":"world"}',
      ),
      sender: BOT,
      channelName: CHAN,
    });
    expect(useStore.getState().aiWorkflows[SID]?.w1.steps[0].content).toBe(
      "hello world",
    );
  });

  test("step arriving before its workflow is silently dropped", () => {
    emit("TAGMSG", {
      serverId: SID,
      mtags: tag(
        '{"msg":"step","wid":"unknown","sid":"s1","type":"reasoning","state":"start"}',
      ),
      sender: BOT,
      channelName: CHAN,
    });
    expect(useStore.getState().aiWorkflows[SID]?.unknown).toBeUndefined();
  });

  test("malformed tag value is ignored", () => {
    emit("TAGMSG", {
      serverId: SID,
      mtags: tag("not-json"),
      sender: BOT,
      channelName: CHAN,
    });
    expect(useStore.getState().aiWorkflows[SID]).toBeUndefined();
  });

  test("aiWorkflowSetCollapsed flips the UI flag", () => {
    emit("TAGMSG", {
      serverId: SID,
      mtags: tag('{"msg":"workflow","id":"w1","state":"start"}'),
      sender: BOT,
      channelName: CHAN,
    });
    useStore.getState().aiWorkflowSetCollapsed(SID, "w1", false);
    expect(useStore.getState().aiWorkflows[SID]?.w1.collapsed).toBe(false);
  });

  test("aiWorkflowDismiss hides without deleting state", () => {
    emit("TAGMSG", {
      serverId: SID,
      mtags: tag('{"msg":"workflow","id":"w1","state":"complete"}'),
      sender: BOT,
      channelName: CHAN,
    });
    useStore.getState().aiWorkflowDismiss(SID, "w1");
    const wf = useStore.getState().aiWorkflows[SID]?.w1;
    expect(wf?.dismissed).toBe(true);
    expect(wf?.state).toBe("complete");
  });

  describe("the run's row in the chat", () => {
    const CHAN_ID = "chan-ai";
    const rows = () => useStore.getState().messages[`${SID}-${CHAN_ID}`] ?? [];
    const startRun = () =>
      emit("TAGMSG", {
        serverId: SID,
        mtags: tag(
          '{"msg":"workflow","id":"w9","state":"start","name":"agent"}',
        ),
        sender: BOT,
        channelName: CHAN,
      });

    beforeEach(() => {
      useStore.setState({
        servers: [
          {
            id: SID,
            name: "srv",
            host: "h",
            port: 1,
            channels: [
              {
                id: CHAN_ID,
                name: CHAN,
                isPrivate: false,
                serverId: SID,
                unreadCount: 0,
                isMentioned: false,
                messages: [],
                users: [],
              },
            ],
            privateChats: [],
            isConnected: true,
            users: [],
          },
        ],
        messages: {},
      } as Partial<AppState>);
    });

    test("stays as a finished row when the run ends with a TAGMSG", () => {
      startRun();
      expect(rows()).toHaveLength(1);
      emit("TAGMSG", {
        serverId: SID,
        mtags: tag('{"msg":"workflow","id":"w9","state":"complete"}'),
        sender: BOT,
        channelName: CHAN,
      });
      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toMatchObject({
        botToolsWorkflowId: "w9",
        botToolsPending: false,
      });
    });

    test("becomes the bot's reply when the final PRIVMSG is tagged", () => {
      startRun();
      emit("CHANMSG", {
        serverId: SID,
        mtags: {
          ...tag('{"msg":"workflow","id":"w9","state":"complete"}'),
          msgid: "final-1",
        },
        sender: BOT,
        channelName: CHAN,
        message: "done",
      });
      expect(rows()[0]).toMatchObject({
        botToolsWorkflowId: "w9",
        botToolsPending: false,
        content: "done",
      });
    });

    test("finishes the run when the final answer arrives as a multiline batch", () => {
      startRun();
      const done = tag('{"msg":"workflow","id":"w9","state":"complete"}')[
        "+draft/bot-tools"
      ];
      const feed = (line: string) =>
        (
          ircClient as unknown as {
            handleMessage(data: string, serverId: string): void;
          }
        ).handleMessage(`${line}\r\n`, SID);
      feed(
        `@+draft/bot-tools=${done};msgid=b-1 :irc.test BATCH +ml1 draft/multiline ${CHAN}`,
      );
      feed(`@batch=ml1;msgid=l-1 :${BOT}!b@h PRIVMSG ${CHAN} :first line`);
      feed(`@batch=ml1;msgid=l-2 :${BOT}!b@h PRIVMSG ${CHAN} :second line`);
      feed(":irc.test BATCH -ml1");

      expect(useStore.getState().aiWorkflows[SID]?.w9?.state).toBe("complete");
      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toMatchObject({
        botToolsWorkflowId: "w9",
        botToolsPending: false,
        content: "first line\nsecond line",
      });
    });
  });
});
