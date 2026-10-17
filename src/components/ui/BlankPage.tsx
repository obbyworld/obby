import { Trans, useLingui } from "@lingui/react/macro";
import type * as React from "react";
import { FaList } from "react-icons/fa";
import { mircToHtml } from "../../lib/ircUtils";
import useStore from "../../store";
import { CollapsibleMessage } from "../message/CollapsibleMessage";

// The fade at the bottom of a folded MOTD has to end in the box's own colour.
const MOTD_GROUND = { "--message-ground": "#202225" } as React.CSSProperties;

const BlankPage: React.FC = () => {
  const { t } = useLingui();
  const {
    servers,
    ui: { selectedServerId },
    openPage,
    globalSettings: { showMotd },
  } = useStore();
  const server = servers.find((s) => s.id === selectedServerId);
  const motd = showMotd ? server?.motd : undefined;

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-4 py-8 overflow-y-auto text-discord-text-muted">
      <div className="text-6xl mb-4">👋</div>
      <h2 className="text-xl font-semibold">
        <Trans>Welcome to {server?.name || "the unknown"}!</Trans>
      </h2>
      <p className="text-sm mt-2">
        <Trans>Select or add a channel to get started.</Trans>
      </p>

      <button
        onClick={() =>
          selectedServerId &&
          openPage({ kind: "channelBrowser", serverId: selectedServerId })
        }
        className="mt-6 flex items-center gap-2 px-4 py-2 bg-discord-dark-400 hover:bg-discord-dark-300 text-discord-text-normal hover:text-white rounded-lg transition-colors duration-200"
        title={t`Server Channels`}
      >
        <FaList />
        <span>
          <Trans>Server Channels</Trans>
        </span>
      </button>

      {motd && motd.length > 0 && (
        <section
          className="mt-8 w-full max-w-2xl rounded-lg bg-discord-dark-300 pb-3"
          style={MOTD_GROUND}
        >
          <div className="section-label px-4 pt-3">
            <Trans>Message of the day</Trans>
          </div>
          <div className="px-4 text-sm text-left text-discord-text-normal whitespace-pre-wrap break-words">
            <CollapsibleMessage content={mircToHtml(motd.join("\n"))} />
          </div>
        </section>
      )}
    </div>
  );
};

export default BlankPage;
