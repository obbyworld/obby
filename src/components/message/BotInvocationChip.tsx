// When a bot's channel reply carries `+draft/invoked-by`, this
// chip renders above the message body to show who ran the slash
// command and which arguments they passed.  The slash command itself
// is sent as a TAGMSG (no chat-visible message), so without this
// attribution other channel members would see only the bot's reply
// with no context for what triggered it.

import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useMemo, useRef, useState } from "react";
import { FaInfoCircle } from "react-icons/fa";
import { base64DecodeUtf8 } from "../../lib/base64";
import useStore from "../../store";
import { Popover } from "../ui/Popover";

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

function filledOptions(
  options: Record<string, string | number | boolean> | undefined,
): [string, string][] {
  return Object.entries(options ?? {})
    .filter(([, v]) => v !== "" && v !== undefined && v !== null)
    .map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]);
}

interface Props {
  tagValue: string | undefined;
  serverId: string;
  botNick: string;
}

export const BotInvocationChip: React.FC<Props> = ({
  tagValue,
  serverId,
  botNick,
}) => {
  const { t } = useLingui();
  const decoded = useMemo(() => decode(tagValue), [tagValue]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  if (!decoded?.name) return null;
  const opts = filledOptions(decoded.options);
  const nick = decoded.nick ?? "";

  return (
    <div className="text-[11px] text-discord-text-muted mb-1 flex items-baseline gap-1 flex-wrap">
      <span className="text-discord-text-normal font-medium">{nick}</span>
      <Trans>ran</Trans>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          useStore
            .getState()
            .requestComposerCommand(serverId, botNick, decoded.name ?? "");
        }}
        className="rounded bg-discord-primary/25 px-1 font-mono text-discord-text-link hover:bg-discord-primary/40 hover:underline"
        title={t`Use /${decoded.name}`}
      >
        /{decoded.name}
      </button>
      {opts.map(([name, value]) => (
        <span key={name} className="inline-flex min-w-0 items-baseline gap-1">
          <span className="font-semibold text-discord-text-normal">{name}</span>
          <span className="break-words rounded bg-white/[0.06] px-1 text-discord-text-normal">
            {value}
          </span>
        </span>
      ))}
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setPopoverOpen((v) => !v);
        }}
        className="text-discord-text-muted/70 hover:text-discord-text-normal focus:outline-none focus:text-discord-text-normal"
        aria-label={t`About this attribution`}
        aria-expanded={popoverOpen}
      >
        <FaInfoCircle className="text-[10px]" />
      </button>
      <Popover
        isOpen={popoverOpen}
        onClose={() => setPopoverOpen(false)}
        anchor={buttonRef.current}
        width={256}
        role="dialog"
        bodyClassName="px-3 py-2 text-sm text-discord-text-normal leading-snug"
      >
        <Trans>
          Information regarding who invoked this command is provided by the bot
          and the sender cannot be verified by the server.
        </Trans>
      </Popover>
    </div>
  );
};

export default BotInvocationChip;
