import { useLingui } from "@lingui/react/macro";
import type * as React from "react";
import { createContext, useContext } from "react";

export interface ChannelLinkApi {
  /** Whether this client knows the channel, so a click has somewhere to go. */
  isKnown: (name: string) => boolean;
  open: (name: string) => void;
}

// The text renderer lives in `lib/` and is reached from the store's own import
// graph, so it must not import the store. The provider supplies these two
// functions from above instead, which keeps `lib/ircUtils` free of that cycle.
export const ChannelLinkContext = createContext<ChannelLinkApi | null>(null);

/** A channel name written in a message. Renders as a link when this client
 * knows the channel, either because the user is in it or because it came back
 * from a LIST. An unknown name stays plain text: most `#word` and `$word` in
 * chat is prose, and a link that joins something on a typo is worse than no
 * link at all. */
export const ChannelLink: React.FC<{
  name: string;
  style?: React.CSSProperties;
}> = ({ name, style }) => {
  const { t } = useLingui();
  const api = useContext(ChannelLinkContext);

  if (!api?.isKnown(name)) {
    return <span style={style}>{name}</span>;
  }

  return (
    <button
      type="button"
      onClick={() => api.open(name)}
      title={t`Go to ${name}`}
      style={style}
      className="text-discord-text-link hover:underline font-medium rounded-sm px-0.5 -mx-0.5 bg-discord-text-link/10 hover:bg-discord-text-link/20 transition-colors align-baseline"
    >
      {name}
    </button>
  );
};
