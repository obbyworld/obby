// When a bot's channel reply carries `+draft/invoked-by`, this
// chip renders above the message body to show who ran the slash
// command and which arguments they passed.  The slash command itself
// is sent as a TAGMSG (no chat-visible message), so without this
// attribution other channel members would see only the bot's reply
// with no context for what triggered it.

import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useMemo } from "react";
import { base64DecodeUtf8 } from "../../lib/base64";

interface Decoded {
  nick?: string;
  name?: string;
  options?: Record<string, string | number | boolean>;
}

function decode(b64: string | undefined): Decoded | null {
  if (!b64) return null;
  try {
    const obj = JSON.parse(base64DecodeUtf8(b64));
    if (!obj || typeof obj !== "object") return null;
    return obj as Decoded;
  } catch {
    return null;
  }
}

function formatOptions(
  options: Record<string, string | number | boolean> | undefined,
): string {
  if (!options) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(options)) {
    if (v === "" || v === undefined || v === null) continue;
    parts.push(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  return parts.join(", ");
}

interface Props {
  tagValue: string | undefined;
}

export const BotInvocationChip: React.FC<Props> = ({ tagValue }) => {
  const decoded = useMemo(() => decode(tagValue), [tagValue]);
  if (!decoded?.name) return null;
  const opts = formatOptions(decoded.options);
  const nick = decoded.nick ?? "";
  return (
    <div className="text-[11px] text-discord-text-muted mb-1 flex items-baseline gap-1 flex-wrap">
      <span className="text-discord-text-normal font-medium">{nick}</span>
      <Trans>ran</Trans>
      <span className="font-mono text-discord-text-link">/{decoded.name}</span>
      {opts && (
        <span className="text-discord-text-muted font-mono truncate max-w-full">
          {opts}
        </span>
      )}
    </div>
  );
};

export default BotInvocationChip;
