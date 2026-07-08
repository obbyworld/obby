import { afterEach, beforeEach, describe, expect, test } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore, { type AppState } from "../../src/store";

const SID = "bouncer-srv";

function getBouncer(state: AppState) {
  return state.bouncers[SID];
}

describe("bouncer store reducer", () => {
  beforeEach(() => {
    useStore.setState({ bouncers: {} } as Partial<AppState>);
  });

  afterEach(() => {
    useStore.setState({ bouncers: {} } as Partial<AppState>);
  });

  test("CAP_ACKNOWLEDGED sets the supported / notifyEnabled flags", () => {
    ircClient.triggerEvent("CAP_ACKNOWLEDGED", {
      serverId: SID,
      key: "soju.im/bouncer-networks",
      capabilities: "",
    });
    ircClient.triggerEvent("CAP_ACKNOWLEDGED", {
      serverId: SID,
      key: "soju.im/bouncer-networks-notify",
      capabilities: "",
    });
    const b = getBouncer(useStore.getState());
    expect(b?.supported).toBe(true);
    expect(b?.notifyEnabled).toBe(true);
  });

  test("BOUNCER_NETWORK upserts a network by netid", () => {
    ircClient.triggerEvent("BOUNCER_NETWORK", {
      serverId: SID,
      netid: "1",
      deleted: false,
      attributes: { name: "Freenode", state: "connected" },
    });
    expect(getBouncer(useStore.getState())?.networks["1"].attributes).toEqual({
      name: "Freenode",
      state: "connected",
    });
  });

  test("a follow-up BOUNCER_NETWORK with partial attrs merges", () => {
    ircClient.triggerEvent("BOUNCER_NETWORK", {
      serverId: SID,
      netid: "1",
      deleted: false,
      attributes: { name: "Freenode", state: "connecting" },
    });
    ircClient.triggerEvent("BOUNCER_NETWORK", {
      serverId: SID,
      netid: "1",
      deleted: false,
      attributes: { state: "connected" },
    });
    expect(getBouncer(useStore.getState())?.networks["1"].attributes).toEqual({
      name: "Freenode",
      state: "connected",
    });
  });

  test("empty-value attr in a notify deletes that attr from the network", () => {
    ircClient.triggerEvent("BOUNCER_NETWORK", {
      serverId: SID,
      netid: "1",
      deleted: false,
      attributes: { name: "Foo", error: "boom" },
    });
    ircClient.triggerEvent("BOUNCER_NETWORK", {
      serverId: SID,
      netid: "1",
      deleted: false,
      attributes: { error: "" },
    });
    expect(getBouncer(useStore.getState())?.networks["1"].attributes).toEqual({
      name: "Foo",
    });
  });

  test("BOUNCER_NETWORK with deleted=true removes the network entry", () => {
    ircClient.triggerEvent("BOUNCER_NETWORK", {
      serverId: SID,
      netid: "1",
      deleted: false,
      attributes: { name: "Foo" },
    });
    ircClient.triggerEvent("BOUNCER_NETWORK", {
      serverId: SID,
      netid: "1",
      deleted: true,
      attributes: {},
    });
    expect(getBouncer(useStore.getState())?.networks["1"]).toBeUndefined();
  });

  test("BOUNCER_FAIL writes lastError onto the bouncer state", () => {
    ircClient.triggerEvent("BOUNCER_FAIL", {
      serverId: SID,
      code: "INVALID_ATTRIBUTE",
      subcommand: "ADDNETWORK",
      netid: "*",
      attribute: "port",
      context: ["*", "port"],
      description: "Invalid attribute value",
    });
    expect(getBouncer(useStore.getState())?.lastError).toMatchObject({
      code: "INVALID_ATTRIBUTE",
      subcommand: "ADDNETWORK",
      attribute: "port",
      netid: "*",
    });
  });

  test("ISUPPORT BOUNCER_NETID is recorded as boundNetid", () => {
    ircClient.triggerEvent("ISUPPORT", {
      serverId: SID,
      key: "BOUNCER_NETID",
      value: "42",
    });
    expect(getBouncer(useStore.getState())?.boundNetid).toBe("42");
  });

  test("BATCH_END for soju.im/bouncer-networks flips listed=true", () => {
    ircClient.triggerEvent("BATCH_START", {
      serverId: SID,
      batchId: "b1",
      type: "soju.im/bouncer-networks",
    });
    ircClient.triggerEvent("BATCH_END", { serverId: SID, batchId: "b1" });
    expect(getBouncer(useStore.getState())?.listed).toBe(true);
  });
});
