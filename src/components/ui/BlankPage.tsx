import { Trans } from "@lingui/react/macro";
import type * as React from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { mircToHtml } from "../../lib/ircUtils";
import useStore from "../../store";
import ConnectionStrip from "../layout/ConnectionStrip";
import NickClaimStrip from "../layout/NickClaimStrip";
import { CollapsibleMessage } from "../message/CollapsibleMessage";
import ChannelBrowser from "../pages/ChannelBrowser";

// The fade at the bottom of a folded MOTD has to end in the box's own colour.
const MOTD_GROUND = { "--message-ground": "#202225" } as React.CSSProperties;

const BlankPage: React.FC = () => {
  const {
    servers,
    ui: { selectedServerId },
    globalSettings: { showMotd },
  } = useStore();
  const server = servers.find((s) => s.id === selectedServerId);
  const isNarrowView = useMediaQuery();
  const motd = showMotd ? server?.motd : undefined;

  return (
    <div className="flex flex-col items-center min-h-full px-4 py-8 text-discord-text-muted">
      <div className="text-6xl mb-4">👋</div>
      <h2 className="text-xl font-semibold">
        <Trans>Welcome to {server?.name || "the unknown"}!</Trans>
      </h2>
      <p className="text-sm mt-2">
        <Trans>Select or add a channel to get started.</Trans>
      </p>

      {/* A phone shows the channel list on its own screen, so we repeat its account strips here. */}
      {server && isNarrowView && (
        <div className="mt-6 w-full max-w-md text-left">
          <ConnectionStrip server={server} />
          <NickClaimStrip server={server} />
        </div>
      )}

      {server?.isRegistered && (
        <ChannelBrowser key={server.id} serverId={server.id}>
          {(count, body) => (
            <section className="mt-8 w-full max-w-6xl flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="section-label">
                  <Trans>Channels</Trans>
                </span>
                {count}
              </div>
              {body}
            </section>
          )}
        </ChannelBrowser>
      )}

      {motd && motd.length > 0 && (
        <section
          className="mt-8 w-full max-w-6xl rounded-lg bg-discord-dark-300 pb-3"
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
