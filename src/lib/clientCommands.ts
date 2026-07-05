// Canonical list of slash commands the client itself handles before
// (or instead of) sending them on the wire.  Kept centralized so the
// suggestion popover (src/components/ui/SlashCommandPopover.tsx) and
// the dispatcher (src/hooks/useMessageSending.ts) can't drift apart.
//
// Each entry mirrors the fields a draft/bot-cmds schema would publish,
// so the popover + param-hint can render them with the same code path
// as PushBot commands.
//
// To add a new client-only command:
//   1. add an entry below
//   2. add the matching `commandName === "..."` branch to handleCommand
//      in src/hooks/useMessageSending.ts
//   3. that's it — the popover and param hint pick it up automatically

import { t } from "@lingui/core/macro";
import type { BotCommandOption } from "../types";

export interface ClientCommand {
  name: string;
  description: string;
  options?: BotCommandOption[];
  /** Where the command makes sense.  Channel-only commands won't
   *  show in DM views. */
  scope?: "anywhere" | "channel-only";
}

// Function rather than module-scope const: `t` evaluates eagerly, and
// at import time the i18n catalogue hasn't been activated yet, so a
// module-level `t\`...\`` would freeze in the source-locale string.
// Callers re-invoke this on every render anyway (it's the popover/dispatcher
// reading the live list), so the per-call allocation is fine.
export function getClientCommands(): ClientCommand[] {
  return [
    {
      name: "me",
      description: t`Send an action / emote`,
      options: [
        {
          name: "action",
          type: "string",
          required: true,
          description: t`What you're doing`,
        },
      ],
    },
    {
      name: "msg",
      description: t`Open a private message to a user`,
      options: [
        { name: "user", type: "user", required: true },
        {
          name: "message",
          type: "string",
          required: true,
          description: t`First message to send`,
        },
      ],
    },
    {
      name: "whisper",
      description: t`Whisper to a user in the current channel context`,
      scope: "channel-only",
      options: [
        { name: "user", type: "user", required: true },
        { name: "message", type: "string", required: true },
      ],
    },
    {
      name: "join",
      description: t`Join a channel`,
      options: [
        {
          name: "channel",
          type: "channel",
          required: true,
          description: t`Channel to join (#name)`,
        },
      ],
    },
    {
      name: "part",
      description: t`Leave a channel`,
      options: [
        {
          name: "channel",
          type: "channel",
          required: false,
          description: t`Channel to leave (defaults to current)`,
        },
      ],
    },
    {
      name: "nick",
      description: t`Change your nickname on this server`,
      options: [
        {
          name: "newnick",
          type: "string",
          required: true,
          description: t`New nickname`,
        },
      ],
    },
    {
      name: "away",
      description: t`Mark yourself as away`,
      options: [
        {
          name: "reason",
          type: "string",
          required: false,
          description: t`Away message`,
        },
      ],
    },
    {
      name: "back",
      description: t`Mark yourself as back`,
    },
  ];
}

// Name set is locale-independent so it can stay module-scope.
export const CLIENT_COMMAND_NAMES: ReadonlySet<string> = new Set([
  "me",
  "msg",
  "whisper",
  "join",
  "part",
  "nick",
  "away",
  "back",
]);
