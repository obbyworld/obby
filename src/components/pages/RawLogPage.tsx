import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { FaCopy, FaTrash } from "react-icons/fa";
import useStore from "../../store";
import { PageShell } from "../ui/page/PageShell";
import type { PageProps } from "./PageHost";

const directionColor: Record<string, string> = {
  tx: "text-blue-300",
  rx: "text-green-300",
  info: "text-yellow-300",
};

const directionPrefix: Record<string, string> = {
  tx: "<<",
  rx: ">>",
  info: "**",
};

const RawLogPage: React.FC<PageProps<"rawLog">> = ({ page }) => {
  const { serverId } = page;
  const lines = useStore((s) => s.rawLog[serverId]);
  const clearRawLog = useStore((s) => s.clearRawLog);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const lineCount = lines?.length ?? 0;
  useEffect(() => {
    if (!scrollRef.current || lineCount === 0) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lineCount]);

  const asText = useMemo(() => {
    if (!lines) return "";
    return lines
      .map((entry) => {
        const time = new Date(entry.timestamp).toISOString().slice(11, 23);
        return `${time} ${directionPrefix[entry.direction] ?? "?"} ${entry.line}`;
      })
      .join("\n");
  }, [lines]);

  const handleCopy = () => {
    navigator.clipboard.writeText(asText).catch(() => {});
  };

  return (
    <PageShell
      title={t`Network log`}
      wide
      fill
      headerActions={
        <>
          <button
            type="button"
            onClick={handleCopy}
            aria-label={t`Copy all`}
            title={t`Copy all`}
            className="icon-button w-10 h-10 rounded-lg"
          >
            <FaCopy className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => clearRawLog(serverId)}
            aria-label={t`Clear`}
            title={t`Clear`}
            className="icon-button w-10 h-10 rounded-lg"
          >
            <FaTrash className="w-3.5 h-3.5" />
          </button>
        </>
      }
    >
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 bg-black/70 border border-discord-dark-500 rounded-lg p-2 overflow-y-auto font-mono text-xs leading-snug"
      >
        {!lines || lines.length === 0 ? (
          <div className="text-discord-text-muted">
            <Trans>
              No raw IRC traffic captured yet. Try connecting or sending a
              message.
            </Trans>
          </div>
        ) : (
          lines.map((entry) => {
            const time = new Date(entry.timestamp).toISOString().slice(11, 23);
            return (
              <div
                key={entry.seq}
                className={`whitespace-pre-wrap break-all ${
                  directionColor[entry.direction] ?? "text-white"
                }`}
              >
                <span className="text-discord-text-muted">{time}</span>{" "}
                <span className="opacity-70">
                  {directionPrefix[entry.direction] ?? "?"}
                </span>{" "}
                {entry.line}
              </div>
            );
          })
        )}
      </div>
    </PageShell>
  );
};

export default RawLogPage;
