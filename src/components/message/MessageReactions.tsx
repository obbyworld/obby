import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import type { MessageType } from "../../types";
import { HoverTooltip } from "../ui/HoverTooltip";
import { MdAddReaction } from "./icons";

interface ReactionData {
  count: number;
  users: string[];
  currentUserReacted: boolean;
}

interface MessageReactionsProps {
  reactions: MessageType["reactions"];
  currentUserUsername?: string;
  onReactionClick: (emoji: string, currentUserReacted: boolean) => void;
  onAddReaction?: (el: Element) => void;
  alwaysShowAdd?: boolean;
}

const MAX_TOOLTIP_NAMES = 20;

const ReactionButton: React.FC<{
  emoji: string;
  reactionData: ReactionData;
  onReactionClick: (emoji: string, currentUserReacted: boolean) => void;
}> = ({ emoji, reactionData, onReactionClick }) => {
  const { t } = useLingui();
  const shown = reactionData.users.slice(0, MAX_TOOLTIP_NAMES);
  const rest = reactionData.users.length - shown.length;
  const names =
    rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");

  return (
    <HoverTooltip
      content={
        <div className="text-center">
          <div className="mb-1 text-2xl">{emoji}</div>
          <div className="text-xs font-semibold leading-relaxed text-white/90">
            {names}
          </div>
          <div className="mt-1 text-[11px] text-white/40">
            <Trans>reacted to this message</Trans>
          </div>
        </div>
      }
    >
      <button
        type="button"
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm transition-all cursor-pointer ${
          reactionData.currentUserReacted
            ? "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
            : "bg-discord-dark-300 text-discord-text-muted hover:bg-discord-dark-200"
        }`}
        onClick={() => onReactionClick(emoji, reactionData.currentUserReacted)}
        aria-label={
          reactionData.currentUserReacted
            ? t`Remove reaction ${emoji}`
            : t`Add reaction ${emoji}`
        }
      >
        <span>{emoji}</span>
        <span className="text-xs font-medium tabular-nums">
          {reactionData.count}
        </span>
      </button>
    </HoverTooltip>
  );
};

export const MessageReactions: React.FC<MessageReactionsProps> = ({
  reactions,
  currentUserUsername,
  onReactionClick,
  onAddReaction,
  alwaysShowAdd = false,
}) => {
  const { t } = useLingui();
  if (!reactions || reactions.length === 0) {
    if (!alwaysShowAdd || !onAddReaction) return null;
    return (
      <div className="flex flex-wrap gap-1 mt-0.5 mb-2 select-none">
        <button
          type="button"
          className="inline-flex items-center px-2 py-0.5 rounded-full text-sm bg-discord-dark-300 text-discord-channels-default hover:bg-discord-dark-200 hover:text-discord-text-muted transition-all"
          title={t`Add reaction`}
          onClick={(e) => onAddReaction(e.currentTarget)}
        >
          <MdAddReaction className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // Group reactions by emoji
  const groupedReactions = reactions.reduce(
    (
      acc: Record<string, ReactionData>,
      reaction: { emoji: string; userId: string },
    ) => {
      if (!acc[reaction.emoji]) {
        acc[reaction.emoji] = {
          count: 0,
          users: [],
          currentUserReacted: false,
        };
      }
      acc[reaction.emoji].count++;
      acc[reaction.emoji].users.push(reaction.userId);
      if (reaction.userId === currentUserUsername) {
        acc[reaction.emoji].currentUserReacted = true;
      }
      return acc;
    },
    {},
  );

  return (
    <div className="flex flex-wrap gap-1 mt-0.5 mb-2 select-none">
      {Object.entries(groupedReactions).map(([emoji, data]) => (
        <ReactionButton
          key={emoji}
          emoji={emoji}
          reactionData={data as ReactionData}
          onReactionClick={onReactionClick}
        />
      ))}
      {onAddReaction && (
        <button
          type="button"
          className="inline-flex items-center px-2 py-0.5 rounded-full text-sm bg-discord-dark-300 text-discord-channels-default hover:bg-discord-dark-200 hover:text-discord-text-muted transition-all"
          title={t`Add reaction`}
          onClick={(e) => onAddReaction(e.currentTarget)}
        >
          <MdAddReaction className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
