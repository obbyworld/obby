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

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((name) => name !== NAV_CACHE).map((name) => caches.delete(name)),
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

// --- web push (draft/webpush, soju.im/webpush) -------------------------
// The server sends exactly one IRC message as the encrypted push payload:
// no trailing CRLF, tags dropped except msgid. The page tells us which server
// owns the subscription and how to word titles, since we have no catalog.

const CONTEXT_CACHE = "obby-push-context";
const CONTEXT_URL = "/__obby-push-context";
const BODY_LIMIT = 200;
const E2EE_BODY_MARKER = "?obe2ee:";

self.addEventListener("message", (event) => {
  if (event.data?.type !== "obby-push-context") return;
  event.waitUntil(
    caches
      .open(CONTEXT_CACHE)
      .then((cache) =>
        cache.put(CONTEXT_URL, new Response(JSON.stringify(event.data))),
      ),
  );
});

async function pushContext() {
  try {
    const cache = await caches.open(CONTEXT_CACHE);
    const response = await cache.match(CONTEXT_URL);
    return response ? await response.json() : null;
  } catch {
    return null;
  }
}

function parseIrcLine(line) {
  let rest = line;
  let msgid = null;
  let time = null;
  if (rest.startsWith("@")) {
    const sp = rest.indexOf(" ");
    if (sp === -1) return null;
    const tags = rest.slice(1, sp);
    for (const t of tags.split(";")) {
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      if (t.slice(0, eq) === "msgid") msgid = t.slice(eq + 1);
      if (t.slice(0, eq) === "time") time = Date.parse(t.slice(eq + 1));
    }
    rest = rest.slice(sp + 1);
  }
  if (!rest.startsWith(":")) return null;
  const sp = rest.indexOf(" ");
  if (sp === -1) return null;
  const nick = rest.slice(1, sp).split("!")[0];
  rest = rest.slice(sp + 1);
  const trailingIdx = rest.indexOf(" :");
  let head = rest;
  let text = "";
  if (trailingIdx !== -1) {
    head = rest.slice(0, trailingIdx);
    text = rest.slice(trailingIdx + 2);
  }
  const parts = head.split(" ");
  return {
    msgid,
    time,
    nick,
    command: parts[0],
    target: parts[1] || "",
    text,
  };
}

function isChannelTarget(target) {
  return !!target && "#&^$+!".includes(target.charAt(0));
}

// What the sender said as notification text, or null for a CTCP other than /me.
function readableText(text, nick, encryptedBody) {
  if (text === E2EE_BODY_MARKER || text.startsWith("?OTR"))
    return encryptedBody;
  if (text.startsWith("\x01")) {
    const ctcp = text.replace(/^\x01|\x01$/g, "");
    return ctcp.startsWith("ACTION ") ? `* ${nick} ${ctcp.slice(7)}` : null;
  }
  return text;
}

function plainBody(text) {
  const plain = text
    .replace(/\x03(\d{1,2}(,\d{1,2})?)?/g, "")
    .replace(/[\x02\x0f\x11\x16\x1d\x1e\x1f]/g, "")
    .trim();
  return plain.length > BODY_LIMIT
    ? `${plain.slice(0, BODY_LIMIT - 1)}…`
    : plain;
}

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let raw;
  try {
    raw = event.data.text();
  } catch {
    return;
  }
  event.waitUntil(
    (async () => {
      const parsed = parseIrcLine(raw);
      if (!parsed?.nick) return;
      if (parsed.command !== "PRIVMSG" && parsed.command !== "NOTICE") return;

      // A focused window shows this message itself.
      const wins = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      if (wins.some((c) => c.focused)) return;

      const context = await pushContext();
      const encryptedBody = context?.encryptedBody ?? "New encrypted message";
      const text = readableText(parsed.text, parsed.nick, encryptedBody);
      if (text === null) return;

      const isChannel = isChannelTarget(parsed.target);
      const chat = isChannel ? parsed.target : parsed.nick;
      const title = isChannel
        ? (context?.channelTitle ?? "{sender} in {target}")
            .replace("{sender}", parsed.nick)
            .replace("{target}", parsed.target)
        : parsed.nick;
      const serverId = context?.serverId ?? "";

      await self.registration.showNotification(title, {
        body: plainBody(text),
        icon: "/pwa/icon-192.png",
        badge: "/pwa/icon-192.png",
        // The page tags its own notifications the same way, so one chat keeps
        // one notification whichever side showed it.
        tag: `${serverId}:${chat.toLowerCase()}`,
        renotify: true,
        data: {
          serverId,
          target: chat,
          time: Number.isNaN(parsed.time) ? Date.now() : (parsed.time ?? Date.now()),
          msgid: parsed.msgid ?? undefined,
        },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        const win = wins.find((c) => "focus" in c);
        if (win) {
          win.postMessage({ type: "obby-notification-tap", target });
          return win.focus();
        }
        const query = encodeURIComponent(JSON.stringify(target));
        return self.clients.openWindow(`/?obbyNotification=${query}`);
      }),
  );
});
