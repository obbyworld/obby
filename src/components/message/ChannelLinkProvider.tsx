import type * as React from "react";
import { useMemo } from "react";
import useStore from "../../store";
import { type ChannelLinkApi, ChannelLinkContext } from "./ChannelLink";

/** Supplies channel lookup and navigation to every channel name rendered in
 * message text. Sits here rather than in the text renderer because that lives
 * in `lib/` and importing the store from there is a cycle. */
export const ChannelLinkProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const serverId = useStore((state) => state.ui.selectedServerId);
  const channels = useStore(
    (state) => state.servers.find((server) => server.id === serverId)?.channels,
  );
  const listed = useStore((state) =>
    serverId ? state.channelList[serverId] : undefined,
  );

  const api = useMemo<ChannelLinkApi>(() => {
    const joined = new Map(
      (channels ?? []).map((channel) => [
        channel.name.toLowerCase(),
        channel.id,
      ]),
    );
    const known = new Set((listed ?? []).map((e) => e.channel.toLowerCase()));
    return {
      isKnown: (name) => {
        const lower = name.toLowerCase();
        return joined.has(lower) || known.has(lower);
      },
      open: (name) => {
        if (!serverId) return;
        const state = useStore.getState();
        const id = joined.get(name.toLowerCase());
        if (id) {
          state.selectChannel(id, { navigate: true });
          return;
        }
        state.joinChannel(serverId, name);
      },
    };
  }, [serverId, channels, listed]);

  return (
    <ChannelLinkContext.Provider value={api}>
      {children}
    </ChannelLinkContext.Provider>
  );
};
