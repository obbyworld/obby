import { beforeEach, describe, expect, test } from "vitest";
import ircClient from "../../src/lib/ircClient";
import type { AppState } from "../../src/store";
import useStore from "../../src/store";

const SID = "srv-1";
const CHAN = "#ai";
const BOT = "researchbot";

function emit(type: "TAGMSG", payload: Record<string, unknown>): void {
  // biome-ignore lint/suspicious/noExplicitAny: triggerEvent is dynamically typed
  ircClient.triggerEvent(type as any, payload as any);
}

function tag(value: string): Record<string, string> {
  return { "+obby.world/ai-tools": value };
}

describe("aiTools store handler", () => {
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
        '{"msg":"step","wid":"unknown","sid":"s1","type":"thinking","state":"start"}',
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
});
