import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { FaCopy, FaTrash } from "react-icons/fa";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";
import useStore from "../../store";

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

const RawLogViewer: React.FC = () => {
  const serverId = useStore((s) => s.rawLogViewerServerId);
  const lines = useStore((s) => (serverId ? s.rawLog[serverId] : undefined));
  const server = useStore((s) =>
    serverId ? s.servers.find((srv) => srv.id === serverId) : undefined,
  );
  const closeRawLogViewer = useStore((s) => s.closeRawLogViewer);
  const clearRawLog = useStore((s) => s.clearRawLog);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isOpen = serverId !== null;

  const lineCount = lines?.length ?? 0;
  useEffect(() => {
    if (!scrollRef.current || lineCount === 0) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lineCount]);

  const asText = useMemo(() => {
    if (!lines) return "";
    return lines
      .map((entry) => {
        const t = new Date(entry.timestamp).toISOString().slice(11, 23);
        return `${t} ${directionPrefix[entry.direction] ?? "?"} ${entry.line}`;
      })
      .join("\n");
  }, [lines]);

  const handleCopy = () => {
    navigator.clipboard.writeText(asText).catch(() => {});
  };

  const handleClear = () => {
    if (serverId) clearRawLog(serverId);
  };

  const title = server
    ? `${server.name || server.host}:${server.port} — Raw IRC Log`
    : "Raw IRC Log";

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={closeRawLogViewer}
      title={<span>{title}</span>}
      maxWidth="2xl"
    >
      <ModalBody>
        <div
          ref={scrollRef}
          className="bg-black/70 border border-discord-dark-500 rounded p-2 h-[60vh] overflow-y-auto font-mono text-xs leading-snug"
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
              const t = new Date(entry.timestamp).toISOString().slice(11, 23);
              return (
                <div
                  key={entry.seq}
                  className={`whitespace-pre-wrap break-all ${
                    directionColor[entry.direction] ?? "text-white"
                  }`}
                >
                  <span className="text-discord-text-muted">{t}</span>{" "}
                  <span className="opacity-70">
                    {directionPrefix[entry.direction] ?? "?"}
                  </span>{" "}
                  {entry.line}
                </div>
              );
            })
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={handleClear}>
          <FaTrash className="inline mr-1" />
          <Trans>Clear</Trans>
        </Button>
        <Button variant="secondary" onClick={handleCopy}>
          <FaCopy className="inline mr-1" />
          <Trans>Copy all</Trans>
        </Button>
        <Button variant="primary" onClick={closeRawLogViewer}>
          <Trans>Close</Trans>
        </Button>
      </ModalFooter>
    </BaseModal>
  );
};

export default RawLogViewer;
