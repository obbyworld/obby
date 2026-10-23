import { describe, expect, test } from "vitest";
import {
  type ChannelListEntry,
  getJoinChannelResults,
} from "../../../src/components/ui/QuickActions/joinChannelResults";

const listEntry = (channel: string, userCount = 5): ChannelListEntry => ({
  channel,
  userCount,
  topic: "",
});

const baseParams = {
  serverId: "srv1",
  serverName: "TestServer",
  joinedChannelNames: [] as string[],
  listEntries: [] as ChannelListEntry[],
  hasVoiceCapability: false,
};

describe("getJoinChannelResults", () => {
  test("a bare query with no sigil produces nothing", () => {
    expect(getJoinChannelResults({ ...baseParams, query: "general" })).toEqual(
      [],
    );
  });

  test("# query behaves as before: LIST fuzzy match plus free-form join", () => {
    const results = getJoinChannelResults({
      ...baseParams,
      query: "#gen",
      listEntries: [listEntry("#general")],
    });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.data)).toEqual([
      { channelName: "#general" },
      { channelName: "#gen" },
    ]);
    expect(results.every((r) => r.type === "join-channel")).toBe(true);
  });

  test("^name produces a join result on a server with the voice capability", () => {
    const results = getJoinChannelResults({
      ...baseParams,
      query: "^lounge",
      hasVoiceCapability: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].data).toEqual({ channelName: "^lounge" });
  });

  test("$name produces a join result on a server with the voice capability", () => {
    const results = getJoinChannelResults({
      ...baseParams,
      query: "$show",
      hasVoiceCapability: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].data).toEqual({ channelName: "$show" });
  });

  test("^name produces nothing without the voice capability", () => {
    expect(
      getJoinChannelResults({
        ...baseParams,
        query: "^lounge",
        hasVoiceCapability: false,
      }),
    ).toEqual([]);
  });

  test("$name produces nothing without the voice capability", () => {
    expect(
      getJoinChannelResults({
        ...baseParams,
        query: "$show",
        hasVoiceCapability: false,
      }),
    ).toEqual([]);
  });

  test("an already-joined channel is not offered again from the LIST match", () => {
    const results = getJoinChannelResults({
      ...baseParams,
      query: "#gen",
      listEntries: [listEntry("#general")],
      joinedChannelNames: ["#general"],
    });

    expect(results.map((r) => r.data)).not.toContainEqual({
      channelName: "#general",
    });
  });

  test("LIST entries match by fuzzy name for each prefix", () => {
    const text = getJoinChannelResults({
      ...baseParams,
      query: "#gen",
      listEntries: [listEntry("#general")],
    });
    expect(text[0].data).toEqual({ channelName: "#general" });

    const voice = getJoinChannelResults({
      ...baseParams,
      query: "^lou",
      listEntries: [listEntry("^lounge")],
      hasVoiceCapability: true,
    });
    expect(voice[0].data).toEqual({ channelName: "^lounge" });

    const stream = getJoinChannelResults({
      ...baseParams,
      query: "$sh",
      listEntries: [listEntry("$show")],
      hasVoiceCapability: true,
    });
    expect(stream[0].data).toEqual({ channelName: "$show" });
  });
});
