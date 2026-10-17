import { Trans } from "@lingui/react/macro";
import type * as React from "react";
import { useUserColor } from "../../hooks/useUserColor";
import useStore from "../../store";
import type { User } from "../../types";

const EMPTY_ARRAY: User[] = [];

export const TypingIndicator: React.FC<{
  serverId: string;
  channelId: string;
}> = ({ serverId, channelId }) => {
  const key = `${serverId}-${channelId}`;
  const typingUsers = useStore(
    (state) => state.typingUsers[key] ?? EMPTY_ARRAY,
  );

  const color0 = useUserColor(serverId, typingUsers[0]?.username);
  const color1 = useUserColor(serverId, typingUsers[1]?.username);
  const color2 = useUserColor(serverId, typingUsers[2]?.username);

  let content: React.ReactNode = null;
  if (typingUsers.length === 1) {
    content = (
      <Trans>
        <span style={color0 ? { color: color0 } : undefined}>
          {typingUsers[0].username}
        </span>{" "}
        is typing...
      </Trans>
    );
  } else if (typingUsers.length === 2) {
    content = (
      <Trans>
        <span style={color0 ? { color: color0 } : undefined}>
          {typingUsers[0].username}
        </span>{" "}
        and{" "}
        <span style={color1 ? { color: color1 } : undefined}>
          {typingUsers[1].username}
        </span>{" "}
        are typing...
      </Trans>
    );
  } else if (typingUsers.length === 3) {
    content = (
      <Trans>
        <span style={color0 ? { color: color0 } : undefined}>
          {typingUsers[0].username}
        </span>
        ,{" "}
        <span style={color1 ? { color: color1 } : undefined}>
          {typingUsers[1].username}
        </span>{" "}
        and{" "}
        <span style={color2 ? { color: color2 } : undefined}>
          {typingUsers[2].username}
        </span>{" "}
        are typing...
      </Trans>
    );
  } else if (typingUsers.length > 3) {
    content = (
      <Trans>
        <span style={color0 ? { color: color0 } : undefined}>
          {typingUsers[0].username}
        </span>
        ,{" "}
        <span style={color1 ? { color: color1 } : undefined}>
          {typingUsers[1].username}
        </span>
        ,{" "}
        <span style={color2 ? { color: color2 } : undefined}>
          {typingUsers[2].username}
        </span>{" "}
        and {typingUsers.length - 3} others are typing...
      </Trans>
    );
  }

  return <div className="h-5 ml-5 text-sm italic">{content}</div>;
};
