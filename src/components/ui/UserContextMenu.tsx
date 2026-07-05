import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createIgnorePattern, isUserIgnored } from "../../lib/ignoreUtils";
import useStore from "../../store";
import type { ModerationAction } from "./ModerationModal";

interface UserContextMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  username: string;
  serverId: string;
  channelId: string;
  onClose: () => void;
  onOpenPM: (username: string) => void;
  onOpenProfile?: (username: string) => void;
  currentUserStatus?: string;
  currentUsername?: string;
  onOpenModerationModal?: (action: ModerationAction) => void;
  /** When the user clicks a bot command in the submenu, the parent
   *  should open the slash-command param modal pre-filled for that
   *  bot + command (mirrors BotsModal.onPickCommand). */
  onPickBotCommand?: (
    botNick: string,
    command: import("../../types").BotCommand,
  ) => void;
}

export const UserContextMenu: React.FC<UserContextMenuProps> = ({
  isOpen,
  x,
  y,
  username,
  serverId,
  channelId,
  onClose,
  onOpenPM,
  onOpenProfile,
  currentUserStatus,
  currentUsername,
  onOpenModerationModal,
  onPickBotCommand,
}) => {
  const { t } = useLingui();
  const menuRef = useRef<HTMLDivElement>(null);
  const [openAccordion, setOpenAccordion] = useState<string | null>(null);

  const toggleAccordion = (accordionName: string) => {
    setOpenAccordion(openAccordion === accordionName ? null : accordionName);
  };

  // Get user metadata
  const servers = useStore((state) => state.servers);
  const server = servers.find((s) => s.id === serverId);
  const user =
    server?.channels
      .flatMap((c) => c.users)
      .find((u) => u.username === username) ||
    server?.users.find((u) => u.username === username);

  const website = user?.metadata?.url?.value || user?.metadata?.website?.value;
  const status = user?.metadata?.status?.value;
  const isBot = !!user?.isBot || user?.metadata?.bot?.value === "true";
  const botCommands = useStore(
    (state) =>
      state.servers.find((s) => s.id === serverId)?.botCommands?.[
        username.toLowerCase()
      ] ?? null,
  );
  const requestBotsModalOpen = useStore((state) => state.requestBotsModalOpen);
  const [botCommandsOpen, setBotCommandsOpen] = useState(false);
  const botRowRef = useRef<HTMLButtonElement>(null);
  const botCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [botSubmenuPos, setBotSubmenuPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const cancelBotClose = () => {
    if (botCloseTimer.current) {
      clearTimeout(botCloseTimer.current);
      botCloseTimer.current = null;
    }
  };
  const scheduleBotClose = () => {
    cancelBotClose();
    botCloseTimer.current = setTimeout(() => {
      setBotCommandsOpen(false);
    }, 150);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Close whenever the mobile panel changes (swipe navigation, channel switch, etc.)
  const mobileViewActiveColumn = useStore(
    (state) => state.ui.mobileViewActiveColumn,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — close on any view change, onClose is stable enough
  useEffect(() => {
    if (isOpen) onClose();
  }, [mobileViewActiveColumn]);

  const handleOpenPM = () => {
    onOpenPM(username);
    onClose();
  };

  const handleOpenProfile = () => {
    if (onOpenProfile) {
      onOpenProfile(username);
    }
    onClose();
  };

  const handleWarnUser = () => {
    if (onOpenModerationModal) {
      onOpenModerationModal("warn");
    }
    onClose();
  };

  const handleKickUser = () => {
    if (onOpenModerationModal) {
      onOpenModerationModal("kick");
    }
    onClose();
  };

  const handleBanUserByNick = () => {
    if (onOpenModerationModal) {
      onOpenModerationModal("ban-nick");
    }
    onClose();
  };

  const handleBanUserByHostmask = () => {
    if (onOpenModerationModal) {
      onOpenModerationModal("ban-hostmask");
    }
    onClose();
  };

  // Ignore list functionality
  const globalSettings = useStore((state) => state.globalSettings);
  const addToIgnoreList = useStore((state) => state.addToIgnoreList);
  const removeFromIgnoreList = useStore((state) => state.removeFromIgnoreList);

  const isIgnored = isUserIgnored(
    username,
    undefined,
    undefined,
    globalSettings.ignoreList,
  );

  const handleIgnoreUser = () => {
    const pattern = createIgnorePattern(username);
    addToIgnoreList(pattern);
    onClose();
  };

  const handleUnignoreUser = () => {
    // Find and remove any patterns that match this user
    const matchingPatterns = globalSettings.ignoreList.filter((pattern) =>
      isUserIgnored(username, undefined, undefined, [pattern]),
    );

    matchingPatterns.forEach((pattern) => {
      removeFromIgnoreList(pattern);
    });
    onClose();
  };

  const getStatusPriority = (status?: string): number => {
    if (!status) return 1;
    let maxPriority = 1;
    for (const char of status) {
      let priority = 1;
      switch (char) {
        case "~":
          priority = 6;
          break;
        case "&":
          priority = 5;
          break;
        case "@":
          priority = 4;
          break;
        case "%":
          priority = 3;
          break;
        case "+":
          priority = 2;
          break;
      }
      if (priority > maxPriority) maxPriority = priority;
    }
    return maxPriority;
  };

  const canModerate = getStatusPriority(currentUserStatus) >= 3; // halfop or higher
  const isOwnUser = username === currentUsername;

  if (!isOpen) return null;

  // Adjust position to prevent menu from going off-screen and respect height constraints
  const maxHeight = 400;
  const menuHeight = Math.min(maxHeight, window.innerHeight - 20); // Leave 20px margin from bottom
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - menuHeight - 10); // Leave 10px margin from bottom

  const menuContent = (
    <>
      {/* Backdrop: absorbs any tap/click outside the menu so it closes cleanly
          and prevents the underlying element from receiving the same tap. */}
      <div className="fixed inset-0 z-[99999]" onClick={onClose} />
      <div
        ref={menuRef}
        className="fixed z-[100000] bg-discord-dark-300 border border-discord-dark-500 rounded-md shadow-xl w-[200px] max-h-[400px] overflow-y-auto"
        style={{
          left: adjustedX,
          top: adjustedY,
          maxHeight: `${menuHeight}px`,
        }}
      >
        <div className="py-1">
          <div className="px-3 py-2 text-xs text-discord-text-muted font-semibold uppercase tracking-wide border-b border-discord-dark-500 mb-1">
            {username}
            {status && (
              <div className="text-xs text-discord-text-normal normal-case mt-1">
                {status}
              </div>
            )}
            {website && (
              <div className="text-xs text-discord-text-normal normal-case mt-1">
                🌐 {website}
              </div>
            )}
          </div>
          <button
            onClick={handleOpenPM}
            className="w-full px-3 py-2 text-left text-discord-text-normal hover:bg-discord-dark-200 hover:text-white transition-colors duration-150 flex items-center gap-2"
            title={t`Send Message`}
          >
            <svg
              className="w-4 h-4 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <span className="truncate">
              <Trans>Send Message</Trans>
            </span>
          </button>
          <button
            onClick={handleOpenProfile}
            className="w-full px-3 py-2 text-left text-discord-text-normal hover:bg-discord-dark-200 hover:text-white transition-colors duration-150 flex items-center gap-2"
            title={t`View Profile`}
          >
            <svg
              className="w-4 h-4 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
            <span className="truncate">
              <Trans>View Profile</Trans>
            </span>
          </button>
          {isBot && botCommands && botCommands.length > 0 && (
            <button
              ref={botRowRef}
              type="button"
              onMouseEnter={() => {
                cancelBotClose();
                const r = botRowRef.current?.getBoundingClientRect();
                if (r) {
                  setBotSubmenuPos({ left: r.right + 4, top: r.top });
                }
                setBotCommandsOpen(true);
              }}
              onMouseLeave={scheduleBotClose}
              onClick={() => {
                cancelBotClose();
                const r = botRowRef.current?.getBoundingClientRect();
                if (r) {
                  setBotSubmenuPos({ left: r.right + 4, top: r.top });
                }
                setBotCommandsOpen((v) => !v);
              }}
              className="w-full px-3 py-2 text-left text-discord-text-normal hover:bg-discord-dark-200 hover:text-white transition-colors duration-150 flex items-center gap-2"
              aria-haspopup="menu"
              aria-expanded={botCommandsOpen}
            >
              <svg
                className="w-4 h-4 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 9l3 3-3 3M13 15h3M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z"
                />
              </svg>
              <span className="truncate flex-1">
                <Trans>Bot Commands</Trans>
              </span>
              <span className="text-xs text-discord-text-muted">
                {botCommands.length}
              </span>
              <span
                className="text-discord-text-muted text-xs"
                aria-hidden="true"
              >
                ▸
              </span>
            </button>
          )}
          {!isOwnUser && (
            <button
              onClick={isIgnored ? handleUnignoreUser : handleIgnoreUser}
              className={`w-full px-3 py-2 text-left transition-colors duration-150 flex items-center gap-2 ${
                isIgnored
                  ? "text-green-400 hover:bg-discord-dark-200 hover:text-green-300"
                  : "text-red-400 hover:bg-discord-dark-200 hover:text-red-300"
              }`}
            >
              <svg
                className="w-4 h-4 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                {isIgnored ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L18.364 5.636M5.636 18.364l12.728-12.728"
                  />
                )}
              </svg>
              <span className="truncate">
                {isIgnored ? (
                  <Trans>Unignore User</Trans>
                ) : (
                  <Trans>Ignore User</Trans>
                )}
              </span>
            </button>
          )}
          {canModerate && !isOwnUser && (
            <>
              <button
                onClick={handleWarnUser}
                className="w-full px-3 py-2 text-left text-discord-text-normal hover:bg-discord-dark-200 hover:text-white transition-colors duration-150 flex items-center gap-2"
              >
                <svg
                  className="w-4 h-4 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
                <span className="truncate">
                  <Trans>Warn User</Trans>
                </span>
              </button>
              <button
                onClick={handleKickUser}
                className="w-full px-3 py-2 text-left text-discord-text-normal hover:bg-discord-dark-200 hover:text-white transition-colors duration-150 flex items-center gap-2"
              >
                <svg
                  className="w-4 h-4 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
                <span className="truncate">
                  <Trans>Kick User</Trans>
                </span>
              </button>
              <div className="border-t border-discord-dark-500 mt-1 pt-1">
                <button
                  onClick={() => toggleAccordion("bans")}
                  className="w-full px-3 py-2 text-left text-discord-text-normal hover:bg-discord-dark-200 hover:text-white transition-colors duration-150 flex items-center gap-2"
                >
                  <svg
                    className="w-4 h-4 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="truncate">
                    <Trans>Ban User</Trans>
                  </span>
                  <svg
                    className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${openAccordion === "bans" ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {openAccordion === "bans" && (
                  <div className="ml-4 space-y-1 animate-in slide-in-from-top-1 duration-200">
                    <button
                      onClick={handleBanUserByNick}
                      className="w-full px-3 py-2 text-left text-discord-text-normal hover:bg-discord-dark-200 hover:text-white transition-colors duration-150 text-sm truncate"
                      title={t`Ban by Nickname`}
                    >
                      <Trans>Ban by Nickname</Trans>
                    </button>
                    <button
                      onClick={handleBanUserByHostmask}
                      className="w-full px-3 py-2 text-left text-discord-text-normal hover:bg-discord-dark-200 hover:text-white transition-colors duration-150 text-sm truncate"
                      title={t`Ban by Hostmask`}
                    >
                      <Trans>Ban by Hostmask</Trans>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {/* Bot Commands flyout — portal-sibling of the main menu so it
          isn't clipped by the menu's overflow-y-auto.  Positioned in
          viewport coords from the row's bounding rect. */}
      {botCommandsOpen &&
        botCommands &&
        botCommands.length > 0 &&
        botSubmenuPos && (
          <div
            className="fixed w-64 bg-discord-dark-300 border border-discord-dark-500 rounded-md shadow-xl pb-1 max-h-[60vh] overflow-y-auto z-[100001]"
            style={{
              left: Math.min(botSubmenuPos.left, window.innerWidth - 260),
              top: Math.min(
                botSubmenuPos.top,
                window.innerHeight -
                  Math.min(window.innerHeight * 0.6, 400) -
                  10,
              ),
            }}
            role="menu"
            onMouseEnter={cancelBotClose}
            onMouseLeave={scheduleBotClose}
          >
            <div className="sticky top-0 z-10 bg-discord-dark-300 border-b border-discord-dark-500">
              <button
                type="button"
                onClick={() => {
                  requestBotsModalOpen(serverId, username);
                  onClose();
                }}
                className="w-full px-3 py-2 text-left text-xs font-semibold text-discord-text-normal hover:bg-discord-dark-200 hover:text-white transition-colors"
              >
                <Trans>Show in Bots Menu →</Trans>
              </button>
            </div>
            {botCommands.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => {
                  if (onPickBotCommand) onPickBotCommand(username, c);
                  onClose();
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-discord-dark-200 transition-colors"
              >
                <div className="font-mono text-xs text-discord-text-link">
                  /{c.name}
                </div>
                {c.description && (
                  <div className="text-discord-text-muted text-[11px] truncate">
                    {c.description}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
    </>
  );

  return createPortal(menuContent, document.body);
};

export default UserContextMenu;
