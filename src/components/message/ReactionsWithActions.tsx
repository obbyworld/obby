import type React from "react";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import type { MessageType } from "../../types";
import { MessageActions } from "./MessageActions";
import { MessageReactions } from "./MessageReactions";

interface ReactionsWithActionsProps {
  message: MessageType;
  currentUserUsername?: string;
  onReactionClick: (emoji: string, currentUserReacted: boolean) => void;
  onReactClick: (buttonElement: Element) => void;
  onReplyClick: () => void;
  onRedactClick?: () => void;
  onOpenMedia?: () => void;
  canRedact?: boolean;
  canReply?: boolean;
  canOpenMedia?: boolean;
}

export const ReactionsWithActions: React.FC<ReactionsWithActionsProps> = ({
  message,
  currentUserUsername,
  onReactionClick,
  onReactClick,
  onReplyClick,
  onRedactClick,
  onOpenMedia,
  canRedact = false,
  canReply = true,
  canOpenMedia = false,
}) => {
  const isTouchDevice = useIsTouchInput();
  const hasReactions = !!message.reactions?.length;

  if (!isTouchDevice && hasReactions) {
    return (
      <div className="flex items-end gap-2 mt-1">
        <div className="flex-1 min-w-0">
          <MessageReactions
            reactions={message.reactions}
            currentUserUsername={currentUserUsername}
            onReactionClick={onReactionClick}
            onAddReaction={onReactClick}
          />
        </div>
        <MessageActions
          message={message}
          onReplyClick={onReplyClick}
          onReactClick={onReactClick}
          onRedactClick={onRedactClick}
          onOpenMedia={onOpenMedia}
          canRedact={canRedact}
          canReply={canReply}
          canOpenMedia={canOpenMedia}
          inline
        />
      </div>
    );
  }

  return (
    <>
      <MessageReactions
        reactions={message.reactions}
        currentUserUsername={currentUserUsername}
        onReactionClick={onReactionClick}
        onAddReaction={isTouchDevice ? undefined : onReactClick}
      />
      {!isTouchDevice && (
        <MessageActions
          message={message}
          onReplyClick={onReplyClick}
          onReactClick={onReactClick}
          onRedactClick={onRedactClick}
          onOpenMedia={onOpenMedia}
          canRedact={canRedact}
          canReply={canReply}
          canOpenMedia={canOpenMedia}
        />
      )}
    </>
  );
};
