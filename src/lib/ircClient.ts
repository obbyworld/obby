export { type EventMap, IRCClient } from "./irc/IRCClient";

import { IRCClient } from "./irc/IRCClient";
export const ircClient = new IRCClient();

// Reaching the live client from the devtools console is the only way to watch
// raw IRC traffic, which protocol work (E2EE handshakes, tags) depends on.
if (import.meta.env.DEV) {
  Object.assign(globalThis, { ircClient });
}

export default ircClient;
