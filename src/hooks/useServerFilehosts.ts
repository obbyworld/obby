import { useMemo } from "react";
import { serverFilehosts } from "../lib/ircUtils";
import useStore from "../store";

// The server advertises its file hosts after the first messages render, so we re-render when they arrive.
export function useServerFilehosts(serverId: string | undefined): string[] {
  const hostsKey = useStore((state) =>
    serverFilehosts(state.servers.find((s) => s.id === serverId)).join(" "),
  );
  return useMemo(() => hostsKey.split(" ").filter(Boolean), [hostsKey]);
}
