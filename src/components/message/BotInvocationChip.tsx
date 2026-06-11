// When a bot's channel reply carries `+draft/invoked-by`, this
// chip renders above the message body to show who ran the slash
// command and which arguments they passed.  The slash command itself
// is sent as a TAGMSG (no chat-visible message), so without this
// attribution other channel members would see only the bot's reply
// with no context for what triggered it.

import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FaInfoCircle } from "react-icons/fa";
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
  const { t } = useLingui();
  const decoded = useMemo(() => decode(tagValue), [tagValue]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopoverOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [popoverOpen]);

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
      <span ref={popoverRef} className="relative inline-flex items-center">
        <button
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
        {popoverOpen && (
          <div
            role="tooltip"
            className="absolute left-0 top-full mt-1 z-20 w-64 rounded-md border border-discord-dark-500 bg-discord-dark-300 p-2 text-[11px] leading-snug text-discord-text-normal shadow-lg"
          >
            <Trans>
              Information regarding who invoked this command is provided by the
              bot and the sender cannot be verified by the server.
            </Trans>
          </div>
        )}
      </span>
    </div>
  );
};

export default BotInvocationChip;
