import { describe, expect, it } from "vitest";
import { E2EE_BODY_MARKER, E2EE_TAG } from "../../../src/lib/e2ee/protocol";
import type { HistoryGap } from "../../../src/lib/history/historyDb";
import {
  buildReplayLines,
  decideAfterGapFill,
  decideAfterLatest,
  HistoryRecorder,
  isLocalReplay,
  LOCAL_BATCH_PREFIX,
  normalizeLine,
  type ParsedLine,
  planLoadMore,
  type RecorderEnv,
  withReplayTags,
} from "../../../src/lib/history/historyLines";
import { KNOWN_CHANTYPES, parseMessageTags } from "../../../src/lib/ircUtils";

const NOW = Date.parse("2024-05-01T12:00:00.000Z");
const NOW_ISO = new Date(NOW).toISOString();
const T1 = "2024-01-01T00:00:00.000Z";
const T1_MS = Date.parse(T1);

function parse(line: string): ParsedLine {
  let rest = line;
  let mtags: Record<string, string> | undefined;
  if (rest.startsWith("@")) {
    const space = rest.indexOf(" ");
    mtags = parseMessageTags(rest.slice(0, space));
    rest = rest.slice(space + 1);
  }
  let source = "";
  if (rest.startsWith(":")) {
    const space = rest.indexOf(" ");
    source = rest.slice(1, space);
    rest = rest.slice(space + 1);
  }
  let trailing: string | undefined;
  const trailingAt = rest.indexOf(" :");
  if (trailingAt >= 0) {
    trailing = rest.slice(trailingAt + 2);
    rest = rest.slice(0, trailingAt);
  }
  const [command, ...parv] = rest.split(" ").filter(Boolean);
  if (trailing !== undefined) parv.push(trailing);
  return { line, command, source, parv, mtags };
}

function setup(overrides: Partial<RecorderEnv> = {}) {
  const env: RecorderEnv = {
    ownNick: () => "me",
    isOpenConversation: () => true,
    hasChathistory: () => false,
    chantypes: () => KNOWN_CHANTYPES,
    isEncryptedPm: () => false,
    now: () => NOW,
    ...overrides,
  };
  const recorder = new HistoryRecorder("s1", env);
  const feed = (line: string) => recorder.feed(parse(line));
  const feedAll = (lines: string[]) => lines.flatMap(feed);
  return { recorder, feed, feedAll };
}

function onlyRows(actions: ReturnType<ReturnType<typeof setup>["feed"]>) {
  expect(actions).toHaveLength(1);
  const [action] = actions;
  if (action.type !== "rows")
    throw new Error(`expected rows, got ${action.type}`);
  return action.rows;
}

describe("normalizeLine", () => {
  it("drops batch and label tags and keeps the rest byte-identical", () => {
    const line =
      "@batch=b1;label=l1;msgid=a\\sb;+x=a\\:b\\\\c;time=" +
      T1 +
      " :n!u@h PRIVMSG #c :hi";
    expect(normalizeLine(line, NOW)).toBe(
      `@msgid=a\\sb;+x=a\\:b\\\\c;time=${T1} :n!u@h PRIVMSG #c :hi`,
    );
  });

  it("adds a time tag from the receive time when missing", () => {
    expect(normalizeLine("@msgid=m1 :n PRIVMSG #c :hi", NOW)).toBe(
      `@msgid=m1;time=${NOW_ISO} :n PRIVMSG #c :hi`,
    );
  });

  it("adds a time tag to a line without any tags", () => {
    expect(normalizeLine(":n PRIVMSG #c :hi", NOW)).toBe(
      `@time=${NOW_ISO} :n PRIVMSG #c :hi`,
    );
  });

  it("adds a time tag when only dropped tags were present", () => {
    expect(normalizeLine("@batch=b;label=l :n PRIVMSG #c :hi", NOW)).toBe(
      `@time=${NOW_ISO} :n PRIVMSG #c :hi`,
    );
  });

  it("keeps an existing time", () => {
    expect(normalizeLine(`@time=${T1} :n PRIVMSG #c :hi`, NOW)).toBe(
      `@time=${T1} :n PRIVMSG #c :hi`,
    );
  });

  it("does not treat tags that merely start with batch or label as dropped", () => {
    expect(normalizeLine("@batchx=1;+label=2 PING", NOW)).toBe(
      `@batchx=1;+label=2;time=${NOW_ISO} PING`,
    );
  });

  it("drops valueless batch and label tags", () => {
    expect(normalizeLine("@batch;label;msgid=m PING", NOW)).toBe(
      `@msgid=m;time=${NOW_ISO} PING`,
    );
  });
});

describe("withReplayTags", () => {
  it("prepends batch and local tags to a tagged line", () => {
    expect(
      withReplayTags("@msgid=m;time=t :n PRIVMSG #c :hi", "obby-local-1"),
    ).toBe("@batch=obby-local-1;obby-local=1;msgid=m;time=t :n PRIVMSG #c :hi");
  });

  it("adds a tag section to an untagged line", () => {
    expect(withReplayTags(":n PRIVMSG #c :hi", "b")).toBe(
      "@batch=b;obby-local=1 :n PRIVMSG #c :hi",
    );
  });
});

describe("isLocalReplay", () => {
  it("is true for a batch id with the local prefix", () => {
    expect(isLocalReplay({ batch: `${LOCAL_BATCH_PREFIX}7` })).toBe(true);
  });

  it("is false for other batch ids, no batch and no tags", () => {
    expect(isLocalReplay({ batch: "abc" })).toBe(false);
    expect(isLocalReplay({ msgid: "m" })).toBe(false);
    expect(isLocalReplay(undefined)).toBe(false);
  });
});

describe("buildReplayLines", () => {
  it("wraps rows in a chathistory batch for the target", () => {
    expect(buildReplayLines("#c", [], "obby-local-1")).toEqual([
      "BATCH +obby-local-1 chathistory #c",
      "BATCH -obby-local-1",
    ]);
  });

  it("tags only the first line of each row", () => {
    const lines = buildReplayLines(
      "#c",
      [
        { raw: "@msgid=a;time=t :n PRIVMSG #c :one" },
        {
          raw: [
            "@msgid=b;time=t :n BATCH +ml draft/multiline #c",
            "@batch=ml :n PRIVMSG #c :x",
            "@batch=ml;draft/multiline-concat :n PRIVMSG #c :y",
            ":n BATCH -ml",
          ].join("\r\n"),
        },
      ],
      "obby-local-2",
    );
    expect(lines).toEqual([
      "BATCH +obby-local-2 chathistory #c",
      "@batch=obby-local-2;obby-local=1;msgid=a;time=t :n PRIVMSG #c :one",
      "@batch=obby-local-2;obby-local=1;msgid=b;time=t :n BATCH +ml draft/multiline #c",
      "@batch=ml :n PRIVMSG #c :x",
      "@batch=ml;draft/multiline-concat :n PRIVMSG #c :y",
      ":n BATCH -ml",
      "BATCH -obby-local-2",
    ]);
  });

  it("produces first lines that isLocalReplay recognises", () => {
    const [, first] = buildReplayLines(
      "#c",
      [{ raw: "@time=t PING" }],
      "obby-local-3",
    );
    expect(isLocalReplay(parse(first).mtags)).toBe(true);
  });
});

describe("channel and private messages", () => {
  it("stores a channel PRIVMSG with a lowercased target and msgid key", () => {
    const { feed } = setup();
    const [row] = onlyRows(
      feed(`@msgid=m1;time=${T1} :alice!u@h PRIVMSG #Chan :hello`),
    );
    expect(row).toEqual({
      server: "s1",
      target: "#chan",
      time: T1_MS,
      key: "m1",
      msgid: "m1",
      raw: `@msgid=m1;time=${T1} :alice!u@h PRIVMSG #Chan :hello`,
    });
  });

  it("uses the receive time when there is no time tag", () => {
    const { feed } = setup();
    const [row] = onlyRows(feed("@msgid=m1 :alice!u@h PRIVMSG #c :hi"));
    expect(row.time).toBe(NOW);
    expect(row.raw).toBe(`@msgid=m1;time=${NOW_ISO} :alice!u@h PRIVMSG #c :hi`);
  });

  it("falls back to the receive time for an unparseable time tag", () => {
    const { feed } = setup();
    const [row] = onlyRows(
      feed("@msgid=m1;time=garbage :a!u@h PRIVMSG #c :hi"),
    );
    expect(row.time).toBe(NOW);
  });

  it("stores a channel NOTICE", () => {
    const { feed } = setup();
    const [row] = onlyRows(feed("@msgid=m1 :srv NOTICE #c :hi"));
    expect(row.target).toBe("#c");
  });

  it("does not store a NOTICE to our nick", () => {
    const { feed } = setup();
    expect(feed("@msgid=m1 :srv NOTICE me :hi")).toEqual([]);
  });

  it("stores a NOTICE for a private target inside a chathistory batch", () => {
    const { feedAll } = setup();
    const actions = feedAll([
      "BATCH +h chathistory alice",
      "@batch=h;msgid=m1 :alice!u@h NOTICE me :hi",
      "BATCH -h",
    ]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "history-batch",
      target: "alice",
      rows: [{ target: "alice", msgid: "m1" }],
    });
  });

  it("skips CTCP requests but keeps ACTION", () => {
    const { feed } = setup();
    expect(feed("@msgid=m1 :a!u@h PRIVMSG #c :\x01VERSION\x01")).toEqual([]);
    const [row] = onlyRows(
      feed("@msgid=m2 :a!u@h PRIVMSG #c :\x01ACTION waves\x01"),
    );
    expect(row.msgid).toBe("m2");
  });

  it("keys an incoming PM by the sender", () => {
    const { feed } = setup();
    const [row] = onlyRows(feed("@msgid=m1 :Alice!u@h PRIVMSG me :hi"));
    expect(row.target).toBe("alice");
  });

  it("keys our own echoed PM by the recipient", () => {
    const { feed } = setup();
    const [row] = onlyRows(feed("@msgid=m1 :me!u@h PRIVMSG Alice :hi"));
    expect(row.target).toBe("alice");
  });

  it("recognises our own nick case-insensitively", () => {
    const { feed } = setup({ ownNick: () => "ME" });
    const [row] = onlyRows(feed("@msgid=m1 :me!u@h PRIVMSG alice :hi"));
    expect(row.target).toBe("alice");
  });

  it("ignores a PRIVMSG without a target or text", () => {
    const { feed } = setup();
    expect(feed("@msgid=m1 :a!u@h PRIVMSG")).toEqual([]);
  });

  it("stores messages on other channel prefixes", () => {
    const { feed } = setup();
    expect(onlyRows(feed("@msgid=m1 :a!u@h PRIVMSG &Loc :hi"))[0].target).toBe(
      "&loc",
    );
  });
});

describe("msgid and chathistory handling", () => {
  it("stores nothing without a msgid when the server has chathistory", () => {
    const { feed } = setup({ hasChathistory: () => true });
    expect(feed(`@time=${T1} :a!u@h PRIVMSG #c :hi`)).toEqual([]);
    expect(feed(":a!u@h PRIVMSG #c :hi")).toEqual([]);
  });

  it("stores a msgid line when the server has chathistory", () => {
    const { feed } = setup({ hasChathistory: () => true });
    expect(
      onlyRows(feed(`@msgid=m1;time=${T1} :a!u@h PRIVMSG #c :hi`)),
    ).toHaveLength(1);
  });

  it("keys a msgid-less line by time and the untagged line when there is no chathistory", () => {
    const { feed } = setup();
    const [row] = onlyRows(feed(`@time=${T1} :a!u@h PRIVMSG #c :hi`));
    expect(row.key).toBe(`${T1_MS}|:a!u@h PRIVMSG #c :hi`);
    expect(row.msgid).toBeUndefined();
    expect("msgid" in row).toBe(false);
  });

  it("keys a tagless line by the receive time", () => {
    const { feed } = setup();
    const [row] = onlyRows(feed(":a!u@h PRIVMSG #c :hi"));
    expect(row.key).toBe(`${NOW}|:a!u@h PRIVMSG #c :hi`);
  });

  it("gives identical key to the same untagged line at the same time", () => {
    const { feed } = setup();
    const a = onlyRows(feed(`@time=${T1};account=x :a!u@h PRIVMSG #c :hi`))[0];
    const b = onlyRows(feed(`@time=${T1} :a!u@h PRIVMSG #c :hi`))[0];
    expect(a.key).toBe(b.key);
  });
});

describe("end to end encryption", () => {
  it.each([
    "?OTR:AAMD",
    "?OTR|abc|def",
    "?OTR,1,2,x",
    "?OTR Error: oops",
    "?OTRv23?",
    "?OTR?",
    E2EE_BODY_MARKER,
  ])("does not store a channel or PM body %s", (body) => {
    const { feed } = setup();
    expect(feed(`@msgid=m1 :a!u@h PRIVMSG #c :${body}`)).toEqual([]);
    expect(feed(`@msgid=m2 :a!u@h PRIVMSG me :${body}`)).toEqual([]);
  });

  it("stores a body that merely mentions OTR", () => {
    const { feed } = setup();
    expect(
      onlyRows(feed("@msgid=m1 :a!u@h PRIVMSG #c :what is ?OTR: anyway")),
    ).toHaveLength(1);
  });

  it("does not store a TAGMSG carrying the e2ee tag", () => {
    const { feed } = setup();
    expect(
      feed(
        `@msgid=m1;${E2EE_TAG}=payload;+draft/react=x;+draft/reply=p :a!u@h TAGMSG #c`,
      ),
    ).toEqual([]);
    expect(feed(`@msgid=m1;${E2EE_TAG}=payload :a!u@h TAGMSG me`)).toEqual([]);
  });

  it("does not store PMs with a nick whose session is encrypted", () => {
    const { feed } = setup({ isEncryptedPm: (nick) => nick === "alice" });
    expect(feed("@msgid=m1 :alice!u@h PRIVMSG me :hi")).toEqual([]);
    expect(feed("@msgid=m2 :me!u@h PRIVMSG alice :hi")).toEqual([]);
    expect(
      feed("@msgid=m3;+draft/react=x;+draft/reply=m1 :alice!u@h TAGMSG me"),
    ).toEqual([]);
    expect(
      feed("@msgid=m4;+draft/react=x;+draft/reply=m1 :me!u@h TAGMSG alice"),
    ).toEqual([]);
    expect(onlyRows(feed("@msgid=m5 :bob!u@h PRIVMSG me :hi"))[0].target).toBe(
      "bob",
    );
  });

  it("stores channel messages even when a nick of that name is encrypted", () => {
    const { feed } = setup({ isEncryptedPm: () => true });
    expect(onlyRows(feed("@msgid=m1 :alice!u@h PRIVMSG #c :hi"))).toHaveLength(
      1,
    );
  });
});

describe("TAGMSG", () => {
  it("does not store a typing-only TAGMSG", () => {
    const { feed } = setup();
    expect(feed("@msgid=m1;+typing=active :a!u@h TAGMSG #c")).toEqual([]);
  });

  it("stores a reaction as a row referencing its reply target", () => {
    const { feed } = setup();
    const [row] = onlyRows(
      feed(
        "@msgid=m2;+draft/react=%F0%9F%91%8D;+draft/reply=m1 :a!u@h TAGMSG #Chan",
      ),
    );
    expect(row).toMatchObject({
      target: "#chan",
      key: "m2",
      msgid: "m2",
      ref: "m1",
    });
  });

  it.each([
    "+draft/react",
    "+draft/unreact",
    "+react",
    "+unreact",
  ])("treats %s as a reaction tag", (tag) => {
    const { feed } = setup();
    const [row] = onlyRows(
      feed(`@msgid=m2;${tag}=x;+draft/reply=m1 :a!u@h TAGMSG #c`),
    );
    expect(row.ref).toBe("m1");
  });

  it("accepts +reply as the reference tag", () => {
    const { feed } = setup();
    const [row] = onlyRows(
      feed("@msgid=m2;+draft/react=x;+reply=m1 :a!u@h TAGMSG #c"),
    );
    expect(row.ref).toBe("m1");
  });

  it("prefers +draft/reply over +reply", () => {
    const { feed } = setup();
    const [row] = onlyRows(
      feed(
        "@msgid=m2;+draft/react=x;+draft/reply=m1;+reply=m9 :a!u@h TAGMSG #c",
      ),
    );
    expect(row.ref).toBe("m1");
  });

  it("does not store a reaction without a reply tag", () => {
    const { feed } = setup();
    expect(feed("@msgid=m2;+draft/react=x :a!u@h TAGMSG #c")).toEqual([]);
  });

  it("stores a reaction in a PM keyed by the other party", () => {
    const { feed } = setup();
    const [row] = onlyRows(
      feed("@msgid=m2;+draft/react=x;+draft/reply=m1 :Alice!u@h TAGMSG me"),
    );
    expect(row.target).toBe("alice");
  });
});

describe("REDACT", () => {
  it("emits a redact action for a channel", () => {
    const { feed } = setup();
    expect(feed(":a!u@h REDACT #Chan m1 :oops")).toEqual([
      { type: "redact", target: "#chan", msgid: "m1" },
    ]);
  });

  it("keys a PM redact by the other party", () => {
    const { feed } = setup();
    expect(feed(":Alice!u@h REDACT me m1")).toEqual([
      { type: "redact", target: "alice", msgid: "m1" },
    ]);
    expect(feed(":me!u@h REDACT Alice m1")).toEqual([
      { type: "redact", target: "alice", msgid: "m1" },
    ]);
  });

  it("emits nothing without a msgid", () => {
    const { feed } = setup();
    expect(feed(":a!u@h REDACT #c")).toEqual([]);
  });

  it("does not need a msgid tag on the REDACT line itself", () => {
    const { feed } = setup({ hasChathistory: () => true });
    expect(feed(":a!u@h REDACT #c m1")).toHaveLength(1);
  });
});

describe("channel events", () => {
  it.each([
    ["JOIN", ":a!u@h JOIN #Chan"],
    ["PART", ":a!u@h PART #Chan :bye"],
    ["QUIT", ":a!u@h QUIT :bye"],
    ["NICK", ":a!u@h NICK :b"],
    ["TOPIC", ":a!u@h TOPIC #Chan :new topic"],
    ["KICK", ":op!u@h KICK #Chan victim :reason"],
    ["MODE", ":op!u@h MODE #Chan +o a"],
  ])("does not store %s live or inside a chathistory batch", (_command, line) => {
    const { feed, feedAll } = setup();
    expect(feed(`@msgid=m1;time=${T1} ${line}`)).toEqual([]);
    expect(
      feedAll([
        "BATCH +h chathistory #Chan",
        `@batch=h;msgid=m2;time=${T1} ${line}`,
        "BATCH -h",
      ]),
    ).toEqual([
      {
        type: "history-batch",
        target: "#chan",
        rows: [],
        redacts: [],
        page: { size: 1, oldest: T1_MS, newest: T1_MS, msgids: ["m2"] },
      },
    ]);
  });

  it("keeps only the message when a chathistory batch also has a JOIN", () => {
    const { feedAll } = setup();
    const [action] = feedAll([
      "BATCH +h chathistory #Chan",
      `@batch=h;msgid=m1;time=${T1} :a!u@h JOIN #Chan`,
      `@batch=h;msgid=m2;time=${T1} :a!u@h PRIVMSG #Chan :hi`,
      "BATCH -h",
    ]);
    if (action.type !== "history-batch")
      throw new Error("expected history-batch");
    expect(action.rows.map((row) => row.msgid)).toEqual(["m2"]);
  });

  it("does not store MODE on our nick", () => {
    const { feed } = setup();
    expect(feed("@msgid=m1 :me!u@h MODE me +i")).toEqual([]);
  });

  it("ignores commands it does not record", () => {
    const { feed } = setup();
    expect(feed("@msgid=m1 :srv 001 me :Welcome")).toEqual([]);
    expect(feed("PING :x")).toEqual([]);
    expect(feed("@msgid=m1 :a!u@h AWAY :gone")).toEqual([]);
  });
});

describe("chathistory batch", () => {
  it("collects inner rows into one history-batch action at the end", () => {
    const { feed } = setup({ hasChathistory: () => true });
    expect(feed("@label=l1 BATCH +h chathistory #Chan")).toEqual([]);
    expect(
      feed(`@batch=h;msgid=m1;time=${T1} :a!u@h PRIVMSG #Chan :one`),
    ).toEqual([]);
    expect(
      feed(`@batch=h;msgid=m2;time=${T1} :b!u@h PRIVMSG #Chan :two`),
    ).toEqual([]);
    const actions = feed("BATCH -h");
    expect(actions).toHaveLength(1);
    const [action] = actions;
    if (action.type !== "history-batch")
      throw new Error("expected history-batch");
    expect(action.target).toBe("#chan");
    expect(action.rows.map((row) => row.msgid)).toEqual(["m1", "m2"]);
    for (const row of action.rows) {
      expect(row.raw).not.toContain("batch=");
      expect(row.raw).toContain(`time=${T1}`);
      expect(row.target).toBe("#chan");
    }
  });

  it("keys PM history by the batch target regardless of sender", () => {
    const { feedAll } = setup();
    const [action] = feedAll([
      "BATCH +h chathistory Alice",
      "@batch=h;msgid=m1 :me!u@h PRIVMSG Alice :out",
      "@batch=h;msgid=m2 :alice!u@h PRIVMSG me :in",
      "BATCH -h",
    ]);
    if (action.type !== "history-batch")
      throw new Error("expected history-batch");
    expect(action.target).toBe("alice");
    expect(action.rows.map((row) => row.target)).toEqual(["alice", "alice"]);
  });

  it("emits a history-batch with no rows for an empty page", () => {
    const { feedAll } = setup();
    expect(feedAll(["BATCH +h chathistory #c", "BATCH -h"])).toEqual([
      {
        type: "history-batch",
        target: "#c",
        rows: [],
        redacts: [],
        page: { size: 0, oldest: undefined, newest: undefined, msgids: [] },
      },
    ]);
  });

  it("skips inner lines without msgid when the server has chathistory", () => {
    const { feedAll } = setup({ hasChathistory: () => true });
    const [action] = feedAll([
      "BATCH +h chathistory #c",
      "@batch=h :a!u@h PRIVMSG #c :one",
      "@batch=h;msgid=m1 :a!u@h PRIVMSG #c :two",
      "BATCH -h",
    ]);
    if (action.type !== "history-batch")
      throw new Error("expected history-batch");
    expect(action.rows.map((row) => row.msgid)).toEqual(["m1"]);
  });

  it("collects reactions inside the batch", () => {
    const { feedAll } = setup();
    const [action] = feedAll([
      "BATCH +h chathistory #c",
      "@batch=h;msgid=m2;+draft/react=x;+draft/reply=m1 :a!u@h TAGMSG #c",
      "BATCH -h",
    ]);
    if (action.type !== "history-batch")
      throw new Error("expected history-batch");
    expect(action.rows[0]).toMatchObject({ msgid: "m2", ref: "m1" });
  });

  it("holds a redact inside a batch until the batch ends", () => {
    const { feedAll } = setup();
    expect(
      feedAll(["BATCH +h chathistory #C", "@batch=h :a!u@h REDACT #C m1"]),
    ).toEqual([]);
    expect(feedAll(["BATCH -h"])).toEqual([
      {
        type: "history-batch",
        target: "#c",
        rows: [],
        redacts: ["m1"],
        page: { size: 1, oldest: undefined, newest: undefined, msgids: [] },
      },
    ]);
  });

  it("emits nothing for a chathistory batch without a target", () => {
    const { feedAll } = setup();
    expect(feedAll(["BATCH +h chathistory", "BATCH -h"])).toEqual([]);
  });

  it("emits nothing for a BATCH end without a start", () => {
    const { feed } = setup();
    expect(feed("BATCH -zzz")).toEqual([]);
  });

  it("does not reuse state between two batches with the same id", () => {
    const { feedAll } = setup();
    const actions = feedAll([
      "BATCH +h chathistory #c",
      "@batch=h;msgid=m1 :a!u@h PRIVMSG #c :one",
      "BATCH -h",
      "BATCH +h chathistory #c",
      "@batch=h;msgid=m2 :a!u@h PRIVMSG #c :two",
      "BATCH -h",
    ]);
    expect(
      actions.map((a) => (a.type === "history-batch" ? a.rows.length : -1)),
    ).toEqual([1, 1]);
  });

  it("emits nothing for other batch types", () => {
    const { feedAll } = setup();
    expect(feedAll(["BATCH +x labeled-response", "BATCH -x"])).toEqual([]);
  });
});

describe("local replay batches", () => {
  it("produces no actions for lines tagged with a local batch id", () => {
    const { feed } = setup();
    expect(
      feed("@batch=obby-local-1;obby-local=1;msgid=m1 :a!u@h PRIVMSG #c :hi"),
    ).toEqual([]);
    expect(
      feed("@batch=obby-local-1;obby-local=1;msgid=m2 :a!u@h QUIT :bye"),
    ).toEqual([]);
    expect(feed("@batch=obby-local-1 :a!u@h REDACT #c m1")).toEqual([]);
  });

  // Replayed multiline rows keep their original inner batch id, so the
  // recorder never sees the (local-tagged) BATCH start that would swallow them.
  it("produces no actions for a replayed multiline row on a server without chathistory", () => {
    const { feedAll } = setup();
    const lines = buildReplayLines(
      "#c",
      [
        {
          raw: [
            `@msgid=M1;time=${T1} :a!u@h BATCH +ml draft/multiline #c`,
            "@batch=ml :a!u@h PRIVMSG #c :one",
            ":a!u@h BATCH -ml",
          ].join("\r\n"),
        },
      ],
      `${LOCAL_BATCH_PREFIX}1`,
    );
    const actions = feedAll(lines).filter((a) => a.type === "rows");
    expect(actions).toEqual([]);
  });

  // buildReplayLines emits the wrapping BATCH lines without any tag, so the
  // recorder registers the batch and emits an empty history-batch at its end,
  // which handleHistoryBatch then pairs with a pending server request.
  it("produces no actions for the BATCH lines of a replay built by buildReplayLines", () => {
    const { feedAll } = setup();
    const lines = buildReplayLines(
      "#c",
      [{ raw: `@msgid=m1;time=${T1} :a!u@h PRIVMSG #c :hi` }],
      `${LOCAL_BATCH_PREFIX}1`,
    );
    expect(feedAll(lines)).toEqual([]);
  });

  it("produces no row actions for the inner lines of a built replay", () => {
    const { feedAll } = setup();
    const lines = buildReplayLines(
      "#c",
      [{ raw: `@msgid=m1;time=${T1} :a!u@h PRIVMSG #c :hi` }],
      `${LOCAL_BATCH_PREFIX}1`,
    );
    const actions = feedAll(lines);
    expect(actions.filter((a) => a.type === "rows")).toEqual([]);
    expect(
      actions.filter((a) => a.type === "history-batch" && a.rows.length),
    ).toEqual([]);
  });
});

describe("draft/multiline batch", () => {
  const start = `@msgid=M1;time=${T1};batch=outerless :Alice!u@h BATCH +ml draft/multiline #Chan`;
  const inner1 = "@batch=ml :Alice!u@h PRIVMSG #Chan :hello ";
  const inner2 =
    "@batch=ml;draft/multiline-concat :Alice!u@h PRIVMSG #Chan :world";
  const end = ":Alice!u@h BATCH -ml";

  it("stores one row with start line, inner lines and end line", () => {
    const { feed } = setup();
    expect(feed(start)).toEqual([]);
    expect(feed(inner1)).toEqual([]);
    expect(feed(inner2)).toEqual([]);
    const [row] = onlyRows(feed(end));
    expect(row.msgid).toBe("M1");
    expect(row.key).toBe("M1");
    expect(row.target).toBe("#chan");
    expect(row.time).toBe(T1_MS);
    expect(row.raw).toBe(
      [
        `@msgid=M1;time=${T1} :Alice!u@h BATCH +ml draft/multiline #Chan`,
        inner1,
        inner2,
        end,
      ].join("\r\n"),
    );
  });

  it("accepts the unprefixed multiline type", () => {
    const { feedAll } = setup();
    const actions = feedAll([
      "@msgid=M1 :a!u@h BATCH +ml multiline #c",
      "@batch=ml :a!u@h PRIVMSG #c :x",
      ":a!u@h BATCH -ml",
    ]);
    expect(onlyRows(actions)[0].msgid).toBe("M1");
  });

  it("keys a multiline PM by the other party", () => {
    const { feedAll } = setup();
    const rows = onlyRows(
      feedAll([
        "@msgid=M1 :Alice!u@h BATCH +ml draft/multiline me",
        "@batch=ml :Alice!u@h PRIVMSG me :x",
        ":Alice!u@h BATCH -ml",
      ]),
    );
    expect(rows[0].target).toBe("alice");
  });

  it("does not store a multiline without msgid when the server has chathistory", () => {
    const { feedAll } = setup({ hasChathistory: () => true });
    expect(
      feedAll([
        ":a!u@h BATCH +ml draft/multiline #c",
        "@batch=ml :a!u@h PRIVMSG #c :x",
        ":a!u@h BATCH -ml",
      ]),
    ).toEqual([]);
  });

  // The inner lines carry a batch tag, so indexOf(" :") in multilineRow hits
  // the source prefix and the classified "body" starts with the source.
  it.each([
    ["obby marker", E2EE_BODY_MARKER],
    ["OTR data", "?OTR:abc"],
  ])("does not store an encrypted multiline body (%s)", (_name, body) => {
    const { feedAll } = setup();
    expect(
      feedAll([
        "@msgid=M1 :a!u@h BATCH +ml draft/multiline #c",
        `@batch=ml :a!u@h PRIVMSG #c :${body}`,
        ":a!u@h BATCH -ml",
      ]),
    ).toEqual([]);
  });

  it("does not store a multiline to an encrypted PM nick", () => {
    const { feedAll } = setup({ isEncryptedPm: () => true });
    expect(
      feedAll([
        "@msgid=M1 :alice!u@h BATCH +ml draft/multiline me",
        "@batch=ml :alice!u@h PRIVMSG me :x",
        ":alice!u@h BATCH -ml",
      ]),
    ).toEqual([]);
  });

  it("does not leak inner lines as separate rows", () => {
    const { feedAll } = setup();
    const actions = feedAll([
      "@msgid=M1 :a!u@h BATCH +ml draft/multiline #c",
      "@batch=ml;msgid=X :a!u@h PRIVMSG #c :x",
      "@batch=ml;msgid=Y :a!u@h PRIVMSG #c :y",
      ":a!u@h BATCH -ml",
    ]);
    expect(onlyRows(actions)).toHaveLength(1);
  });

  it("ends up inside the history-batch action when nested in a chathistory batch", () => {
    const { feed } = setup({ hasChathistory: () => true });
    expect(feed("BATCH +h chathistory #Chan")).toEqual([]);
    expect(
      feed(
        `@batch=h;msgid=M1;time=${T1} :Alice!u@h BATCH +ml draft/multiline #Chan`,
      ),
    ).toEqual([]);
    expect(feed("@batch=ml :Alice!u@h PRIVMSG #Chan :hello")).toEqual([]);
    expect(feed(":Alice!u@h BATCH -ml")).toEqual([]);
    expect(
      feed(`@batch=h;msgid=M2;time=${T1} :Bob!u@h PRIVMSG #Chan :plain`),
    ).toEqual([]);
    const [action] = feed("BATCH -h");
    if (action.type !== "history-batch")
      throw new Error("expected history-batch");
    expect(action.rows.map((row) => row.msgid)).toEqual(["M1", "M2"]);
    expect(action.rows[0].raw.split("\r\n")).toEqual([
      `@msgid=M1;time=${T1} :Alice!u@h BATCH +ml draft/multiline #Chan`,
      "@batch=ml :Alice!u@h PRIVMSG #Chan :hello",
      ":Alice!u@h BATCH -ml",
    ]);
    expect(action.rows[0].target).toBe("#chan");
  });
});

describe("planLoadMore", () => {
  const gap = (overrides: Partial<HistoryGap> = {}): HistoryGap => ({
    id: 1,
    server: "s1",
    target: "#c",
    from: 100,
    to: 200,
    lost: false,
    ...overrides,
  });

  it("goes to disk when there are no gaps and an older row exists", () => {
    expect(
      planLoadMore({
        oldestTime: 500,
        newestOlderRowTime: 400,
        gaps: [],
        hasChathistory: true,
      }),
    ).toEqual({ kind: "disk" });
  });

  it("goes to the server with the gap when the gap is closer than the next disk row", () => {
    const g = gap({ from: 300, to: 400 });
    expect(
      planLoadMore({
        oldestTime: 500,
        newestOlderRowTime: 250,
        gaps: [g],
        hasChathistory: true,
      }),
    ).toEqual({ kind: "server", gap: g, before: g.to });
  });

  it("goes to disk when the next disk row lies above the gap", () => {
    expect(
      planLoadMore({
        oldestTime: 500,
        newestOlderRowTime: 450,
        gaps: [gap({ from: 300, to: 400 })],
        hasChathistory: true,
      }),
    ).toEqual({ kind: "disk" });
  });

  it("goes to the server with the gap when there is no older disk row", () => {
    const g = gap();
    expect(
      planLoadMore({
        oldestTime: 500,
        newestOlderRowTime: undefined,
        gaps: [g],
        hasChathistory: true,
      }),
    ).toEqual({ kind: "server", gap: g, before: g.to });
  });

  it("ignores lost gaps", () => {
    expect(
      planLoadMore({
        oldestTime: 500,
        newestOlderRowTime: 100,
        gaps: [gap({ lost: true, from: 300, to: 400 })],
        hasChathistory: true,
      }),
    ).toEqual({ kind: "disk" });
    expect(
      planLoadMore({
        oldestTime: 500,
        newestOlderRowTime: undefined,
        gaps: [gap({ lost: true })],
        hasChathistory: true,
      }),
    ).toEqual({ kind: "server", before: 500 });
  });

  it("ignores gaps that start after the oldest message on screen", () => {
    expect(
      planLoadMore({
        oldestTime: 500,
        newestOlderRowTime: undefined,
        gaps: [gap({ from: 600, to: 700 })],
        hasChathistory: true,
      }),
    ).toEqual({ kind: "server", before: 500 });
  });

  it("picks the gap with the largest end time", () => {
    const near = gap({ from: 300, to: 450 });
    const far = gap({ from: 100, to: 200 });
    expect(
      planLoadMore({
        oldestTime: 500,
        newestOlderRowTime: 50,
        gaps: [far, near],
        hasChathistory: true,
      }),
    ).toEqual({ kind: "server", gap: near, before: near.to });
  });

  it("goes to the server without a gap when there is no disk row and chathistory", () => {
    expect(
      planLoadMore({
        oldestTime: 500,
        newestOlderRowTime: undefined,
        gaps: [],
        hasChathistory: true,
      }),
    ).toEqual({ kind: "server", before: 500 });
  });

  it("returns none when nothing is available", () => {
    expect(
      planLoadMore({
        oldestTime: 500,
        newestOlderRowTime: undefined,
        gaps: [],
        hasChathistory: false,
      }),
    ).toEqual({ kind: "none" });
  });

  it("falls back to disk when a gap exists but the server has no chathistory", () => {
    expect(
      planLoadMore({
        oldestTime: 500,
        newestOlderRowTime: 250,
        gaps: [gap({ from: 300, to: 400 })],
        hasChathistory: false,
      }),
    ).toEqual({ kind: "disk" });
  });

  it("returns none when a gap exists, there is no disk row and no chathistory", () => {
    expect(
      planLoadMore({
        oldestTime: 500,
        newestOlderRowTime: undefined,
        gaps: [gap()],
        hasChathistory: false,
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("decideAfterLatest", () => {
  const page = { size: 3, oldest: 700 };

  it("adds nothing without a stored time", () => {
    expect(decideAfterLatest({ newestStoredTime: undefined, page })).toEqual({
      kind: "none",
    });
  });

  it("adds nothing for an empty page", () => {
    expect(
      decideAfterLatest({
        newestStoredTime: 500,
        page: { size: 0, oldest: undefined },
      }),
    ).toEqual({ kind: "none" });
  });

  it("adds nothing when the page starts at the newest stored time", () => {
    expect(decideAfterLatest({ newestStoredTime: 700, page })).toEqual({
      kind: "none",
    });
  });

  it("adds nothing when the page starts before the newest stored time", () => {
    expect(decideAfterLatest({ newestStoredTime: 800, page })).toEqual({
      kind: "none",
    });
  });

  it("adds a gap for a page newer than the stored time, however short", () => {
    expect(decideAfterLatest({ newestStoredTime: 500, page })).toEqual({
      kind: "add",
      from: 500,
      to: 700,
    });
    expect(
      decideAfterLatest({
        newestStoredTime: 500,
        page: { ...page, size: 1 },
      }),
    ).toEqual({ kind: "add", from: 500, to: 700 });
  });
});

describe("decideAfterGapFill", () => {
  const gap: HistoryGap = {
    id: 1,
    server: "s1",
    target: "#c",
    from: 100,
    to: 500,
    lost: false,
  };

  it("closes when any row overlapped existing rows", () => {
    expect(
      decideAfterGapFill({
        gap,
        page: { size: 2, oldest: 300 },
        inserted: [true, false],
      }),
    ).toEqual({ kind: "close" });
  });

  it("closes when the page reaches the start of the gap", () => {
    expect(
      decideAfterGapFill({
        gap,
        page: { size: 2, oldest: 100 },
        inserted: [true, true],
      }),
    ).toEqual({ kind: "close" });
    expect(
      decideAfterGapFill({
        gap,
        page: { size: 1, oldest: 50 },
        inserted: [true],
      }),
    ).toEqual({ kind: "close" });
  });

  it("marks the gap lost when the server returns nothing", () => {
    expect(
      decideAfterGapFill({
        gap,
        page: { size: 0, oldest: undefined },
        inserted: [],
      }),
    ).toEqual({
      kind: "shrink",
      to: 500,
      lost: true,
    });
  });

  it("shrinks to the oldest row for a full page", () => {
    expect(
      decideAfterGapFill({
        gap,
        page: { size: 2, oldest: 300 },
        inserted: [true, true],
      }),
    ).toEqual({ kind: "shrink", to: 300, lost: false });
  });

  it("keeps the gap open after a short page, since servers may return fewer than asked", () => {
    expect(
      decideAfterGapFill({
        gap,
        page: { size: 1, oldest: 300 },
        inserted: [true],
      }),
    ).toEqual({ kind: "shrink", to: 300, lost: false });
  });
});

describe("allowlist", () => {
  it.each([
    "NickServ",
    "ChanServ",
    "AuthServ",
    "Q",
  ])("does not store a PM with %s in either direction", (nick) => {
    const { feed } = setup();
    expect(feed(`@msgid=m1 :${nick}!s@services PRIVMSG me :hi`)).toEqual([]);
    expect(feed(`@msgid=m2 :me!u@h PRIVMSG ${nick} :help`)).toEqual([]);
  });

  it.each([
    "IDENTIFY hunter2",
    "identify me hunter2",
    "REGISTER hunter2 me@example.com",
    "GHOST me hunter2",
    "LOGIN me hunter2",
    "OPER me hunter2",
    "SET PASSWORD hunter2",
    "set pass hunter2",
  ])("does not store the credential body %s to any nick", (body) => {
    const { feed } = setup();
    expect(feed(`@msgid=m1 :me!u@h PRIVMSG bob :${body}`)).toEqual([]);
    expect(feed(`@msgid=m2 :bob!u@h PRIVMSG me :${body}`)).toEqual([]);
  });

  it("stores a PM that merely mentions a credential word later on", () => {
    const { feed } = setup();
    expect(
      onlyRows(feed("@msgid=m1 :me!u@h PRIVMSG bob :please identify yourself")),
    ).toHaveLength(1);
  });

  it.each([
    "+channel-context",
    "+draft/channel-context",
  ])("does not store a whisper tagged %s", (tag) => {
    const { feed } = setup();
    expect(feed(`@msgid=m1;${tag}=#c :alice!u@h PRIVMSG me :psst`)).toEqual([]);
    expect(feed(`@msgid=m2;${tag}=#c :alice!u@h PRIVMSG #c :psst`)).toEqual([]);
  });

  it("does not store a PM from a server source", () => {
    const { feed } = setup();
    expect(feed("@msgid=m1 :irc.example.net PRIVMSG me :hello")).toEqual([]);
  });

  it("does not store lines for a conversation that is not open", () => {
    const { feed, feedAll } = setup({
      isOpenConversation: (target) => target === "#open",
    });
    expect(feed("@msgid=m1 :alice!u@h PRIVMSG #closed :hi")).toEqual([]);
    expect(feed("@msgid=m2 :alice!u@h PRIVMSG me :hi")).toEqual([]);
    expect(
      feed(
        "@msgid=m3;+draft/react=x;+draft/reply=m0 :alice!u@h TAGMSG #closed",
      ),
    ).toEqual([]);
    const [action] = feedAll([
      "BATCH +h chathistory #closed",
      "@batch=h;msgid=m4 :alice!u@h PRIVMSG #closed :hi",
      "BATCH -h",
    ]);
    expect(action).toMatchObject({ type: "history-batch", rows: [] });
    expect(
      onlyRows(feed("@msgid=m5 :alice!u@h PRIVMSG #open :hi"))[0].target,
    ).toBe("#open");
  });

  it("does not store a typing TAGMSG live or inside a chathistory batch", () => {
    const { feed, feedAll } = setup();
    expect(feed("@msgid=m1;+typing=active :a!u@h TAGMSG me")).toEqual([]);
    const [action] = feedAll([
      "BATCH +h chathistory #c",
      "@batch=h;msgid=m2;+typing=active :a!u@h TAGMSG #c",
      "BATCH -h",
    ]);
    expect(action).toMatchObject({ type: "history-batch", rows: [] });
  });
});

describe("own lines", () => {
  it("tags our own lines at record time and leaves others untouched", () => {
    const { feed } = setup();
    expect(onlyRows(feed("@msgid=m1 :me!u@h PRIVMSG alice :hi"))[0].raw).toBe(
      `@msgid=m1;time=${NOW_ISO};obby-own=1 :me!u@h PRIVMSG alice :hi`,
    );
    expect(
      onlyRows(feed("@msgid=m2 :alice!u@h PRIVMSG me :hi"))[0].raw,
    ).not.toContain("obby-own");
  });

  it("rewrites the source of our own replayed lines to the current nick", () => {
    const lines = buildReplayLines(
      "alice",
      [
        { raw: "@msgid=m1;time=t;obby-own=1 :oldnick!u@h PRIVMSG alice :mine" },
        { raw: "@msgid=m2;time=t :alice!u@h PRIVMSG oldnick :theirs" },
      ],
      "obby-local-1",
      "newnick!newnick@local",
    );
    expect(lines.slice(1, 3)).toEqual([
      "@batch=obby-local-1;obby-local=1;msgid=m1;time=t;obby-own=1 :newnick!newnick@local PRIVMSG alice :mine",
      "@batch=obby-local-1;obby-local=1;msgid=m2;time=t :alice!u@h PRIVMSG oldnick :theirs",
    ]);
  });
});

describe("page size", () => {
  it("counts event lines we leave off disk in the page size", () => {
    const { feedAll } = setup();
    const at = (i: number) => new Date(T1_MS + i * 1000).toISOString();
    const lines = Array.from({ length: 50 }, (_, i) =>
      i < 20
        ? `@batch=h;msgid=j${i};time=${at(i)} :u${i}!u@h JOIN #c`
        : `@batch=h;msgid=p${i};time=${at(i)} :u${i}!u@h PRIVMSG #c :hi`,
    );
    const [action] = feedAll(["BATCH +h chathistory #c", ...lines, "BATCH -h"]);
    if (action.type !== "history-batch")
      throw new Error("expected history-batch");
    expect(action.rows).toHaveLength(30);
    expect(action.page).toMatchObject({ size: 50, oldest: T1_MS });
    expect(action.page.newest).toBe(T1_MS + 49_000);
    expect(action.page.msgids).toHaveLength(50);
  });
});

describe("planLoadMore gap edges", () => {
  it("picks a gap that starts below the oldest message even when it ends above it", () => {
    const gap: HistoryGap = {
      id: 1,
      server: "s1",
      target: "#c",
      from: 300,
      to: 700,
      lost: false,
    };
    expect(
      planLoadMore({
        oldestTime: 500,
        newestOlderRowTime: undefined,
        gaps: [gap],
        hasChathistory: true,
      }),
    ).toEqual({ kind: "server", gap, before: 500 });
  });
});
