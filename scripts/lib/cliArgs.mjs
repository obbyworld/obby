export const USAGE = `Usage: npm run test-video-call -- <host> <port> <room> [--delay <seconds>]

  host    IRC server hostname (connects over wss://; pass ws://host for plaintext)
  port    IRC server port
  room    voice or stream channel, must start with ^ or $ (e.g. ^test, $mystream)
  --delay seconds to wait before echoing your audio back (default: 1)

Example:
  npm run test-video-call -- irc.h4ks.com 6608 '^test'

Requires ffmpeg on PATH -- it generates the test-pattern video this tool publishes.`;

export class ArgsError extends Error {}

export function parseArgs(argv) {
  const positional = [];
  let delaySeconds = 1;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--delay") {
      i++;
      if (argv[i] === undefined) throw new ArgsError("--delay needs a value");
      delaySeconds = Number(argv[i]);
    } else if (arg.startsWith("--delay=")) {
      delaySeconds = Number(arg.slice("--delay=".length));
    } else if (arg === "--help" || arg === "-h") {
      throw new ArgsError(USAGE);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 3) {
    throw new ArgsError(
      `expected 3 arguments (host, port, room), got ${positional.length}`,
    );
  }
  const [host, portRaw, room] = positional;

  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ArgsError(`invalid port: ${portRaw}`);
  }
  if (!room.startsWith("^") && !room.startsWith("$")) {
    throw new ArgsError(`room must start with ^ or $, got: ${room}`);
  }
  if (!Number.isFinite(delaySeconds) || delaySeconds < 0) {
    throw new ArgsError(`invalid --delay: ${delaySeconds}`);
  }

  return { host, port, room, delayMs: Math.round(delaySeconds * 1000) };
}

// wss:// by default -- this app's own IRCClient upgrades any ws:// URL
// it's given to wss:// (see src/lib/irc/IRCClient.ts), so a plaintext
// obbyircd test instance is the exception, not the rule. Pass a host
// already prefixed with ws:// or wss:// to override.
export function buildWsUrl(host, port) {
  if (host.startsWith("wss://")) return `wss://${host.slice(6)}:${port}`;
  if (host.startsWith("ws://")) return `ws://${host.slice(5)}:${port}`;
  return `wss://${host}:${port}`;
}
