import { t } from "@lingui/core/macro";
import type * as React from "react";
import { useRef, useState } from "react";
import { FaChevronRight, FaEllipsisH, FaFolder } from "react-icons/fa";
import type { FolderSummary } from "../../lib/channelFolders";
import type { ChannelFolder } from "../../store/types";
import { TextInput } from "../ui/TextInput";
import type { DragRowProps } from "./ChannelRow";

interface ChannelFolderHeaderProps {
  folder: ChannelFolder;
  summary?: FolderSummary;
  isRenaming: boolean;
  drop?: DragRowProps;
  onToggle: () => void;
  onOpenMenu: (anchor: HTMLElement) => void;
  onRename: (name: string) => void;
  onRenameEnd: () => void;
}

const FolderNameInput: React.FC<{
  initial: string;
  onRename: (name: string) => void;
  onRenameEnd: () => void;
}> = ({ initial, onRename, onRenameEnd }) => {
  const [name, setName] = useState(initial);
  // Unmounting the input blurs it, so Escape has to stop that blur from saving.
  const isCancelled = useRef(false);
  const commit = () => {
    if (isCancelled.current) return;
    if (name.trim()) onRename(name.trim());
    onRenameEnd();
  };
  return (
    <TextInput
      className="flex-1 min-w-0 h-6 px-1 rounded bg-discord-dark-400 text-xs text-white outline-none"
      aria-label={t`Folder name`}
      value={name}
      onChange={(e) => setName(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          isCancelled.current = true;
          onRenameEnd();
        }
      }}
      autoFocus
    />
  );
};

const FolderActivity: React.FC<{ summary?: FolderSummary }> = ({ summary }) => {
  if (summary?.mentionCount)
    return (
      <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
        {summary.mentionCount}
      </span>
    );
  if (summary?.hasUnread)
    return (
      <span className="ml-auto mr-1 w-2 h-2 flex-shrink-0 bg-blue-500 rounded-full" />
    );
  return null;
};

export const ChannelFolderHeader: React.FC<ChannelFolderHeaderProps> = ({
  folder,
  summary,
  isRenaming,
  drop,
  onToggle,
  onOpenMenu,
  onRename,
  onRenameEnd,
}) => (
  <div
    {...drop}
    className={`group flex items-center gap-0.5 mt-3.5 mb-1 pl-1 ${drop?.className ?? ""}`}
    onContextMenu={(e) => {
      e.preventDefault();
      onOpenMenu(e.currentTarget);
    }}
  >
    {isRenaming ? (
      <span className="flex items-center gap-1.5 flex-1 min-w-0 text-xs">
        <FaFolder className="flex-shrink-0 opacity-80" />
        <FolderNameInput
          initial={folder.name}
          onRename={onRename}
          onRenameEnd={onRenameEnd}
        />
      </span>
    ) : (
      <button
        type="button"
        aria-expanded={!folder.collapsed}
        onClick={onToggle}
        className={`flex items-center gap-1.5 min-w-0 flex-1 h-6 text-left text-xs font-semibold hover:text-discord-text-normal ${
          folder.collapsed && summary?.hasUnread ? "text-white" : ""
        }`}
      >
        <FaFolder className="flex-shrink-0 opacity-80" />
        <span className="truncate">{folder.name}</span>
        <FaChevronRight
          className={`flex-shrink-0 text-[9px] opacity-70 transition-transform ${
            folder.collapsed ? "" : "rotate-90"
          }`}
        />
        {folder.collapsed && (
          <span className="font-medium text-discord-text-muted">
            {summary?.channelCount ?? 0}
          </span>
        )}
        {folder.collapsed && <FolderActivity summary={summary} />}
      </button>
    )}
    <button
      type="button"
      title={t`Rename or delete folder`}
      aria-label={t`Rename or delete ${folder.name}`}
      onClick={(e) => onOpenMenu(e.currentTarget)}
      className="w-6 h-6 flex items-center justify-center rounded opacity-0 [@media(hover:none)]:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 hover:text-white hover:bg-discord-dark-500/40"
    >
      <FaEllipsisH className="text-xs" />
    </button>
  </div>
);

export default ChannelFolderHeader;
