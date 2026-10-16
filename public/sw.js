// Minimal service worker for the hosted-PWA build mode. Its only jobs:
//   1. Satisfy the browser's PWA install criteria (must have a registered
//      SW with a fetch handler).
//   2. Cache the navigation response so the chrome reloads without the
//      network when the user opens the installed PWA offline.
//
// Hashed asset bundles get their own cache identity automatically since
// the URL changes on every deploy; we never serve a stale asset, just
// fall back to whatever's cached when fetch fails. The HTML cache is
// trimmed to the single latest navigation entry to avoid unbounded
// growth.

const NAV_CACHE = "obby-hosted-nav-v1";
const CONTEXT_CACHE = "obby-push-context";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== NAV_CACHE && name !== CONTEXT_CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  if (req.mode === "navigate") {
    // Network-first: always try the live network so a fresh deploy is
    // picked up immediately. Cache the response for the offline path.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(NAV_CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() =>
          caches
            .open(NAV_CACHE)
            .then((c) => c.match("/").then((r) => r || Response.error())),
        ),
    );
    return;
  }
});

// Web push (draft/webpush, soju.im/webpush). Each server registers this
// worker under its own scope, and the server sends one IRC message per push
// with only the msgid tag. The page sends us its wording, since we have no
// catalog, plus the server's channel prefixes, our nick, custom mentions and
// the ignore list.

const BODY_LIMIT = 200;
const E2EE_BODY_MARKER = "?obe2ee:";
const CONTEXT_URL = new URL("__obby-push-context", self.registration.scope).href;
const shownByPage = new Set();

function serverIdOfScope() {
  const [, prefix, id] = new URL(self.registration.scope).pathname.split("/");
  return prefix === "push" && id ? decodeURIComponent(id) : null;
}

function isPushContext(context) {
  return (
    typeof context?.channelTitle === "string" &&
    typeof context.encryptedBody === "string" &&
    typeof context.chantypes === "string" &&
    typeof context.nick === "string" &&
    [context.ignoreList, context.customMentions].every(
      (list) => Array.isArray(list) && list.every((item) => typeof item === "string"),
    )
  );
}

self.addEventListener("message", (event) => {
  if (!(event.source instanceof WindowClient)) return;
  const data = event.data;
  if (data?.type === "obby-shown" && typeof data.msgid === "string") {
    shownByPage.add(data.msgid);
    if (shownByPage.size > 200) shownByPage.delete(shownByPage.values().next().value);
    return;
  }
  if (data?.type !== "obby-push-context" || !isPushContext(data.context)) return;
  event.waitUntil(
    caches
      .open(CONTEXT_CACHE)
      .then((cache) =>
        cache.put(CONTEXT_URL, new Response(JSON.stringify(data.context))),
      ),
  );
});

async function pushContext() {
  const cache = await caches.open(CONTEXT_CACHE);
  const response = await cache.match(CONTEXT_URL);
  return response ? response.json() : null;
}

function unescapeTagValue(value) {
  return value.replace(/\\(.?)/g, (_, c) =>
    ({ ":": ";", s: " ", r: "\r", n: "\n", "\\": "\\" })[c] ?? c,
  );
}

function parseIrcLine(line) {
  let rest = line;
  let msgid = null;
  let time = null;
  if (rest.startsWith("@")) {
    const sp = rest.indexOf(" ");
    if (sp === -1) return null;
    for (const tag of rest.slice(1, sp).split(";")) {
      const eq = tag.indexOf("=");
      if (eq === -1) continue;
      const value = unescapeTagValue(tag.slice(eq + 1));
      if (tag.slice(0, eq) === "msgid") msgid = value;
      if (tag.slice(0, eq) === "time") time = Date.parse(value);
    }
    rest = rest.slice(sp + 1);
  }
  if (!rest.startsWith(":")) return null;
  const sp = rest.indexOf(" ");
  if (sp === -1) return null;
  const source = rest.slice(1, sp);
  rest = rest.slice(sp + 1);
  const trailingIdx = rest.indexOf(" :");
  const params =
    trailingIdx === -1
      ? rest.split(" ")
      : [...rest.slice(0, trailingIdx).split(" "), rest.slice(trailingIdx + 2)];
  return {
    msgid,
    time,
    source,
    nick: source.split("!")[0],
    command: params[0]?.toUpperCase(),
    target: params[1] ?? "",
    text: params[2] ?? "",
  };
}

function matchesIgnorePattern(hostmask, pattern) {
  const regex = pattern
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`).test(hostmask.toLowerCase());
}

// What the sender said as notification text, or null for a CTCP other than /me.
function readableText(text, nick, encryptedBody) {
  if (text === E2EE_BODY_MARKER || text.startsWith("?OTR"))
    return encryptedBody;
  if (text.startsWith("\x01")) {
    const ctcp = text.replace(/^\x01|\x01$/g, "");
    if (ctcp === "ACTION") return `* ${nick}`;
    return ctcp.startsWith("ACTION ") ? `* ${nick} ${ctcp.slice(7)}` : null;
  }
  return text;
}

function plainBody(text) {
  const plain = text
    .replace(/\x03\d{0,2}(,\d{0,2})?/g, "")
    .replace(/[\x02\x0f\x11\x16\x1d\x1e\x1f]/g, "")
    .trim();
  return plain.length > BODY_LIMIT
    ? `${plain.slice(0, BODY_LIMIT - 1)}…`
    : plain;
}

async function closeChatNotifications(tag) {
  for (const shown of await self.registration.getNotifications({ tag }))
    shown.close();
}

// A nick is made of RFC 2812 nick characters plus the dash, so a name is only
// addressed when nothing on either side could be part of a longer name.
const NICK_CHARACTER = /[A-Za-z0-9[\]\\`_^{}|-]/;

function addressesName(content, name) {
  const needle = name.trim().toLowerCase();
  if (!needle) return false;
  const haystack = content.toLowerCase();
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const before = haystack[at - 1];
    const after = haystack[at + needle.length];
    if (
      (before === undefined || !NICK_CHARACTER.test(before)) &&
      (after === undefined || !NICK_CHARACTER.test(after))
    )
      return true;
  }
  return false;
}

function mentionsUs(text, context) {
  return [context?.nick ?? "", ...(context?.customMentions ?? [])].some((name) =>
    addressesName(text, name),
  );
}

// Browsers count a push on a userVisibleOnly subscription that shows nothing
// against the site, so we show and close a silent one for each push we skip.
const QUIET_TAG = "obby-quiet";

async function showQuietly() {
  await self.registration.showNotification("Obby", { tag: QUIET_TAG, silent: true });
  await closeChatNotifications(QUIET_TAG);
}

// Resolves to whether we showed the push as a notification.
async function showPush(event) {
  const serverId = serverIdOfScope();
  if (!event.data || !serverId) return false;
  const parsed = parseIrcLine(event.data.text());
  if (!parsed?.nick) return false;
  if (parsed.command !== "PRIVMSG" && parsed.command !== "NOTICE") return false;
  // We quietly replace the notification the page already showed for this message.
  const isShownByPage = !!parsed.msgid && shownByPage.has(parsed.msgid);
  const context = await pushContext();
  const chantypes = context?.chantypes || "#&";
  const isChannel = chantypes.includes(parsed.target.charAt(0));
  const chat = isChannel ? parsed.target : parsed.nick;
  const tag = `${serverId}:${chat.toLowerCase()}`;
  // Our own message from another client means we already read that chat.
  if (context?.nick && parsed.nick.toLowerCase() === context.nick.toLowerCase()) {
    await closeChatNotifications(isChannel ? tag : `${serverId}:${parsed.target.toLowerCase()}`);
    return false;
  }
  if (context?.ignoreList.some((pattern) => matchesIgnorePattern(parsed.source, pattern)))
    return false;
  if (isChannel && !mentionsUs(parsed.text, context)) return false;

  // A focused window shows this message itself.
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  if (windows.some((client) => client.focused)) return false;

  const encryptedBody = context?.encryptedBody ?? "New encrypted message";
  const text = readableText(parsed.text, parsed.nick, encryptedBody);
  if (text === null) return false;
  const title = isChannel
    ? (context?.channelTitle ?? "{sender} in {target}").replace(
        /\{(sender|target)\}/g,
        (_, field) => (field === "sender" ? parsed.nick : parsed.target),
      )
    : parsed.nick;

  await self.registration.showNotification(title, {
    body: plainBody(text),
    icon: "/pwa/icon-192.png",
    badge: "/pwa/icon-192.png",
    // The page tags its own notifications the same way, so one chat keeps
    // one notification whichever side showed it.
    tag,
    renotify: !isShownByPage,
    silent: isShownByPage,
    data: {
      serverId,
      target: chat,
      time: Number.isNaN(parsed.time) ? Date.now() : (parsed.time ?? Date.now()),
      msgid: parsed.msgid ?? undefined,
    },
  });
  return true;
}

self.addEventListener("push", (event) => {
  event.waitUntil(showPush(event).then((isShown) => isShown || showQuietly()));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const win = windows.find((client) => "focus" in client);
        if (win) {
          win.postMessage({ type: "obby-notification-tap", target });
          return win.focus();
        }
        const query = encodeURIComponent(JSON.stringify(target));
        return self.clients.openWindow(`/?obbyNotification=${query}`);
      }),
  );
});
