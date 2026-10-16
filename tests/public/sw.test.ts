import { readFileSync } from "node:fs";
import vm from "node:vm";
import { beforeEach, describe, expect, it } from "vitest";

type Listener = (event: Record<string, unknown>) => void;
interface Shown {
  title: string;
  options: {
    body: string;
    tag: string;
    renotify: boolean;
    silent: boolean;
    data: Record<string, unknown>;
  };
}

const source = readFileSync("public/sw.js", "utf8");

function loadWorker(
  scope = "https://chat.example/push/srv-1/",
  windows: { focused: boolean }[] = [],
) {
  const listeners: Record<string, Listener> = {};
  const shown: Shown[] = [];
  const closed: string[] = [];
  const cache = new Map<string, string>();
  class WindowClient {}
  const self = {
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = listener;
    },
    skipWaiting() {},
    clients: { claim: async () => {}, matchAll: async () => windows },
    registration: {
      scope,
      showNotification: async (title: string, options: Shown["options"]) => {
        shown.push({ title, options });
      },
      getNotifications: async ({ tag }: { tag: string }) => [
        { close: () => closed.push(tag) },
      ],
    },
  };
  const caches = {
    open: async () => ({
      put: async (key: string, response: Response) =>
        cache.set(key, await response.text()),
      match: async (key: string) =>
        cache.has(key) ? new Response(cache.get(key)) : undefined,
    }),
  };
  vm.runInNewContext(source, {
    self,
    caches,
    Response,
    URL,
    WindowClient,
    Date,
    Number,
    JSON,
    encodeURIComponent,
    decodeURIComponent,
  });

  const dispatch = async (type: string, event: Record<string, unknown>) => {
    const pending: Promise<unknown>[] = [];
    listeners[type]({
      ...event,
      waitUntil: (p: Promise<unknown>) => pending.push(p),
    });
    await Promise.all(pending);
  };
  const post = (data: unknown) =>
    dispatch("message", { data, source: new WindowClient() });
  const push = (line: string) =>
    dispatch("push", { data: { text: () => line } });
  const quiet = () => shown.filter((s) => s.options.tag === "obby-quiet");
  return { shown, closed, post, push, quiet };
}

const context = {
  channelTitle: "{sender} dans {target}",
  encryptedBody: "Nouveau message chiffré",
  chantypes: "#&",
  nick: "Pushy",
  customMentions: ["release"],
  ignoreList: ["troll!*@*"],
};

describe("push service worker", () => {
  let worker: ReturnType<typeof loadWorker>;
  beforeEach(async () => {
    worker = loadWorker();
    await worker.post({ type: "obby-push-context", context });
  });

  it("shows a DM tagged for its server and chat", async () => {
    await worker.push(
      "@msgid=m1;time=2026-10-15T21:15:07.111Z :Alice!a@h PRIVMSG pushy :hello \x02there\x02",
    );
    expect(worker.shown).toHaveLength(1);
    expect(worker.shown[0].title).toBe("Alice");
    expect(worker.shown[0].options.body).toBe("hello there");
    expect(worker.shown[0].options.tag).toBe("srv-1:alice");
    expect(worker.shown[0].options.data).toMatchObject({
      serverId: "srv-1",
      target: "Alice",
      msgid: "m1",
    });
  });

  it("reads a final parameter sent without a colon", async () => {
    await worker.push(":alice!a@h PRIVMSG pushy hi");
    expect(worker.shown[0].options.body).toBe("hi");
  });

  it("builds a channel title from the page's wording in one pass", async () => {
    await worker.push(":{target}!a@h PRIVMSG &a$' :pushy: ping");
    expect(worker.shown[0].title).toBe("{target} dans &a$'");
    expect(worker.shown[0].options.tag).toBe("srv-1:&a$'");
  });

  // Each skipped push shows one silent notification and closes it at once.
  const expectQuiet = (w: ReturnType<typeof loadWorker>) => {
    expect(w.shown).toHaveLength(1);
    expect(w.quiet()[0].options.silent).toBe(true);
    expect(w.closed).toContain("obby-quiet");
  };

  it("stays quiet for ignored users", async () => {
    await worker.push(":troll!t@h PRIVMSG pushy :hey");
    expectQuiet(worker);
  });

  it("shows a channel message that mentions us or a custom mention", async () => {
    await worker.push(":alice!a@h PRIVMSG #dev :the release is out");
    expect(worker.shown[0].title).toBe("alice dans #dev");
  });

  it("stays quiet for channel talk that does not mention us", async () => {
    await worker.push(":alice!a@h PRIVMSG #dev :pushyfoo said hi");
    expectQuiet(worker);
  });

  it.each([
    ["a CTCP other than ACTION", ":alice!a@h PRIVMSG pushy :\x01VERSION\x01"],
    ["another command", ":alice!a@h TAGMSG pushy"],
    ["an unreadable line", "garbage"],
  ])("stays quiet for %s", async (_, line) => {
    await worker.push(line);
    expectQuiet(worker);
  });

  it("silently replaces the notification the page already showed", async () => {
    await worker.post({ type: "obby-shown", msgid: "seen" });
    await worker.push("@msgid=seen :alice!a@h PRIVMSG pushy :hey");
    expect(worker.shown).toHaveLength(1);
    expect(worker.shown[0].options).toMatchObject({
      tag: "srv-1:alice",
      renotify: false,
      silent: true,
    });
  });

  it("clears the chat when our own message arrives from another client", async () => {
    await worker.push(":PUSHY!p@h PRIVMSG Alice :on my way");
    expectQuiet(worker);
    expect(worker.closed).toEqual(["srv-1:alice", "obby-quiet"]);
  });

  it("shows encrypted bodies as the page's wording", async () => {
    await worker.push(":alice!a@h PRIVMSG pushy :?obe2ee:");
    expect(worker.shown[0].options.body).toBe("Nouveau message chiffré");
  });

  it("stays quiet while a window of the app is focused", async () => {
    const focusedWorker = loadWorker(undefined, [{ focused: true }]);
    await focusedWorker.post({ type: "obby-push-context", context });
    await focusedWorker.push(":alice!a@h PRIVMSG pushy :hi");
    expectQuiet(focusedWorker);
  });

  it("ignores pushes on the app's own registration", async () => {
    const appWorker = loadWorker("https://chat.example/");
    await appWorker.push(":alice!a@h PRIVMSG pushy :hi");
    expectQuiet(appWorker);
  });
});
