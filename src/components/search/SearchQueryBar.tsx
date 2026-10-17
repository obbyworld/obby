import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useState } from "react";
import { FaChevronDown, FaGlobe, FaHashtag, FaServer } from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import {
  hasFilledToken,
  hasSearchToken,
  LINK_TOKEN,
  MENTIONS_TOKEN,
} from "../../lib/search/searchQuery";
import {
  chatTargets,
  currentChatScope,
  scopeLabel,
} from "../../lib/search/searchScope";
import type { SearchScope } from "../../lib/search/searchTypes";
import useStore from "../../store";
import type { Server } from "../../types";
import CompletionList from "../ui/CompletionList";
import Menu, { type MenuItem } from "../ui/Menu";
import type { SearchDraft } from "./useSearchDraft";

const keepInputFocus = (e: React.MouseEvent) => e.preventDefault();

export const ScopeIcon: React.FC<{ scope: SearchScope }> = ({ scope }) => {
  if (scope.kind === "everywhere")
    return <FaGlobe className="text-[10px] shrink-0" />;
  if (scope.kind === "network")
    return <FaServer className="text-[10px] shrink-0" />;
  return <FaHashtag className="text-[10px] shrink-0" />;
};

function buildScopeMenuItems(
  servers: Server[],
  currentScope: SearchScope,
  onPick: (scope: SearchScope) => void,
): MenuItem[] {
  const currentServer =
    currentScope.kind === "everywhere"
      ? undefined
      : servers.find((s) => s.id === currentScope.serverId);
  return [
    {
      id: "chat",
      label: t`This chat`,
      description: currentScope.kind === "chat" ? currentScope.target : "",
      icon: <FaHashtag />,
      show: currentScope.kind === "chat",
      onClick: () => onPick(currentScope),
    },
    {
      id: "network",
      label: t`This network`,
      description: currentServer?.name,
      icon: <FaServer />,
      show: !!currentServer,
      onClick: () =>
        currentServer &&
        onPick({ kind: "network", serverId: currentServer.id }),
    },
    {
      id: "everywhere",
      label: t`Everywhere`,
      icon: <FaGlobe />,
      onClick: () => onPick({ kind: "everywhere" }),
    },
    ...servers.map((server, index) => ({
      id: `server-${server.id}`,
      label: server.name,
      description: t`Pick a chat`,
      icon: <FaServer />,
      divider: index === 0,
      submenu: chatTargets([server]).map((target) => ({
        id: `chat-${target.label}`,
        label: target.label,
        onClick: () => onPick(target.scope),
      })),
    })),
  ];
}

export const SearchQueryBar: React.FC<{
  draft: SearchDraft;
  isLarge: boolean;
  completionId: string;
  showCompletion?: boolean;
  completionClassName?: string;
}> = ({
  draft,
  isLarge,
  completionId,
  showCompletion = true,
  completionClassName = "",
}) => {
  const servers = useStore((s) => s.servers);
  const selectedServerId = useStore((s) => s.ui.selectedServerId);
  const selection = useStore((s) =>
    s.ui.selectedServerId
      ? s.ui.perServerSelections[s.ui.selectedServerId]
      : undefined,
  );
  const isTouch = useIsTouchInput();
  const [scopeChip, setScopeChip] = useState<HTMLButtonElement | null>(null);
  const { text, scope, completion } = draft;
  const chipClass = `chip-action shadow-none whitespace-nowrap ${isLarge ? "min-h-11 px-4 text-sm shrink-0" : ""}`;

  const closeScopeMenu = () => {
    draft.setIsScopeMenuOpen(false);
    if (!isTouch) draft.focusInput();
  };
  const scopeMenuItems = buildScopeMenuItems(
    servers,
    currentChatScope(servers, selectedServerId, selection),
    draft.setScope,
  );

  const toggleChip = (token: string, label: React.ReactNode) => (
    <button
      type="button"
      aria-pressed={hasSearchToken(text, token)}
      className={`${chipClass} ${hasSearchToken(text, token) ? "chip-action-active" : ""}`}
      onMouseDown={keepInputFocus}
      onClick={() => draft.toggleToken(token)}
    >
      {label}
    </button>
  );
  const insertChip = (token: string, label: React.ReactNode) => (
    <button
      type="button"
      className={`${chipClass} ${hasFilledToken(text, token) ? "chip-action-active" : ""}`}
      onMouseDown={keepInputFocus}
      onClick={() => draft.insertToken(token)}
    >
      {label}
    </button>
  );

  return (
    <>
      <div
        className={`flex gap-2 px-3 py-2 min-w-0 ${isLarge ? "overflow-x-auto overscroll-x-contain" : "flex-wrap"}`}
      >
        <button
          ref={setScopeChip}
          type="button"
          aria-haspopup="menu"
          aria-expanded={draft.isScopeMenuOpen}
          aria-label={t`Choose where to search`}
          onClick={() => draft.setIsScopeMenuOpen(!draft.isScopeMenuOpen)}
          className={`${chipClass} min-w-0 ${isLarge ? "max-w-[60vw]" : "max-w-full"}`}
        >
          <ScopeIcon scope={scope} />
          <span className="truncate">{scopeLabel(scope, servers)}</span>
          <FaChevronDown className="text-[9px] opacity-70 shrink-0" />
        </button>
        {insertChip(
          "from:",
          <Trans comment="Search filter chip: messages sent by a person">
            From
          </Trans>,
        )}
        {insertChip(
          "in:",
          <Trans comment="Search filter chip: messages in a chat or network">
            In
          </Trans>,
        )}
        {toggleChip(MENTIONS_TOKEN, <Trans>Mentions & replies</Trans>)}
        {toggleChip(LINK_TOKEN, <Trans>Has link</Trans>)}
        {insertChip(
          "after:",
          <Trans comment="Search filter chip: messages sent after a date">
            Date
          </Trans>,
        )}
      </div>
      {showCompletion && completion.isOpen && (
        <div
          className={`overflow-y-auto overscroll-contain p-1 ${completionClassName}`}
        >
          <CompletionList
            completion={completion}
            id={completionId}
            placement="inline"
            embedded
            rowClassName={isLarge ? "min-h-12" : ""}
          />
        </div>
      )}
      <Menu
        isOpen={draft.isScopeMenuOpen}
        onClose={closeScopeMenu}
        menuItems={scopeMenuItems}
        anchorElement={scopeChip}
        width={260}
      />
    </>
  );
};

export default SearchQueryBar;
