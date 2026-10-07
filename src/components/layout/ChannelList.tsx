import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type * as React from "react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  FaArrowDown,
  FaArrowUp,
  FaChevronDown,
  FaChevronRight,
  FaCommentDots,
  FaCrown,
  FaGripVertical,
  FaPen,
  FaPlug,
  FaThumbtack,
  FaTrash,
} from "react-icons/fa";
import { GiGlassShot } from "react-icons/gi";
import { useShallow } from "zustand/react/shallow";
import { useChannelMru } from "../../hooks/useChannelTabSwitching";
import { useDragReorder } from "../../hooks/useDragReorder";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { useJoinAndSelectChannel } from "../../hooks/useJoinAndSelectChannel";
import {
  arrangeChannels,
  type ChannelListEntry,
  flattenChannelGroups,
  isLiveChannel,
  moveDropIntoFolder,
  readDroppedLayout,
  summarizeFolders,
} from "../../lib/channelFolders";
import ircClient from "../../lib/ircClient";
import { serverFilehosts } from "../../lib/ircUtils";
import { canShowAvatarUrl, mediaLevelToSettings } from "../../lib/mediaUtils";
import { isTauriDesktop, isTauriMobile } from "../../lib/platformUtils";
import { getLiveVoiceCalls, subscribeLiveVoiceCalls } from "../../lib/voice";
import useStore from "../../store";
import { useChannelFolders } from "../../store/channelFolders";
import type { ChannelFolder } from "../../store/types";
import type { Channel } from "../../types";
import ChannelSettingsModal from "../ui/ChannelSettingsModal";
import InviteUserModal from "../ui/InviteUserModal";
import Menu from "../ui/Menu";
import AddChannelRow from "./AddChannelRow";
import ChannelContextMenu from "./ChannelContextMenu";
import ChannelFolderHeader from "./ChannelFolderHeader";
import ChannelRow, { type DragRowProps } from "./ChannelRow";
import ConnectionStrip from "./ConnectionStrip";
import NetworkMenu from "./NetworkMenu";
import PrivateChatRow from "./PrivateChatRow";
import StartPrivateChatRow from "./StartPrivateChatRow";
import UserPanel, { type PresenceStatus } from "./UserPanel";

export const ChannelList: React.FC = () => {
  const {
    selectChannel,
    selectPrivateChat,
    leaveChannel,
    deletePrivateChat,
    pinPrivateChat,
    unpinPrivateChat,
    reorderPrivateChats,
    toggleSettingsModal,
    setMobileViewActiveColumn,
    reorderChannels,
  } = useStore();

  const joinAndSelectChannel = useJoinAndSelectChannel();

  const selectedServerId = useStore((state) => state.ui.selectedServerId);
  const selectedChannelId = useStore((state) => {
    if (!state.ui.selectedServerId) return null;
    return (
      state.ui.perServerSelections[state.ui.selectedServerId]
        ?.selectedChannelId || null
    );
  });
  const selectedPrivateChatId = useStore((state) => {
    if (!state.ui.selectedServerId) return null;
    return (
      state.ui.perServerSelections[state.ui.selectedServerId]
        ?.selectedPrivateChatId || null
    );
  });

  const mediaSettings = mediaLevelToSettings(
    useStore((state) => state.globalSettings.mediaVisibilityLevel),
  );

  // useShallow: selector returns a merged object literal on every call; shallow comparison
  // prevents the useSyncExternalStore "getSnapshot should be cached" infinite-loop.
  const currentUser = useStore(
    useShallow((state) => {
      if (!selectedServerId) return null;

      // Get the current user's username from IRCClient
      const ircCurrentUser = ircClient.getCurrentUser(selectedServerId);
      if (!ircCurrentUser) return null;

      // If we have a currentUser in the store that matches this server's current user, use it (it has modes)
      if (
        state.currentUser &&
        state.currentUser.username === ircCurrentUser.username
      ) {
        return state.currentUser;
      }

      // Otherwise, try to find user in channels for metadata and merge with store currentUser if available
      const selectedServer = state.servers.find(
        (s) => s.id === selectedServerId,
      );
      if (!selectedServer) return state.currentUser || ircCurrentUser;

      // Look for the user in any channel
      for (const channel of selectedServer.channels) {
        const userWithMetadata = channel.users.find(
          (u) => u.username === ircCurrentUser.username,
        );
        if (userWithMetadata) {
          // If we have currentUser in store, merge its modes and IRC op status with the channel user's metadata
          if (
            state.currentUser &&
            state.currentUser.username === userWithMetadata.username
          ) {
            return {
              ...userWithMetadata,
              modes: state.currentUser.modes,
              isIrcOp: state.currentUser.isIrcOp,
            };
          }
          return userWithMetadata;
        }
      }

      // If not found in channels, return store currentUser or IRC user
      return state.currentUser || ircCurrentUser;
    }),
  );

  const servers = useStore((state) => state.servers);

  // Voice/stream channels rely on the obsidianirc/voice CAP and the
  // server-side SFU bridge; hide both sections on networks that didn't
  // negotiate it (vanilla IRCds, including those that happen to allow
  // `^` or `$` in CHANTYPES for unrelated reasons).
  const voiceCapEnabled = useStore((state) => {
    if (!state.ui.selectedServerId) return false;
    const srv = state.servers.find((s) => s.id === state.ui.selectedServerId);
    return !!srv?.capabilities?.includes("obsidianirc/voice");
  });

  const [isPrivateChatsOpen, setIsPrivateChatsOpen] = useState(true);
  const [openMenu, setOpenMenu] = useState<
    | { kind: "channel"; channel: Channel; anchor: HTMLElement }
    | { kind: "folder"; folderId: string; anchor: HTMLElement }
    | { kind: "network"; anchor: HTMLElement }
    | { kind: "pm"; privateChatId: string; anchor: HTMLElement }
    | null
  >(null);
  const channelMenu = openMenu?.kind === "channel" ? openMenu : null;
  const folderMenu = openMenu?.kind === "folder" ? openMenu : null;
  const networkMenuAnchor =
    openMenu?.kind === "network" ? openMenu.anchor : null;
  const closeMenu = () => setOpenMenu(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const [modalChannel, setModalChannel] = useState<{
    name: string;
    modal: "settings" | "invite";
  } | null>(null);
  const [clickedPM, setClickedPM] = useState<string | null>(null);
  const lastSelectedPM = useRef<string | null>(null);

  const selectedServer = servers.find(
    (server) => server.id === selectedServerId,
  );

  const upstreamSubtitle = useStore((state) => {
    if (!selectedServer) return undefined;
    if (selectedServer.bouncerServerId && selectedServer.bouncerNetid) {
      const net =
        state.bouncers[selectedServer.bouncerServerId]?.networks[
          selectedServer.bouncerNetid
        ];
      return net?.attributes.host || undefined;
    }
    if (selectedServer.isBouncerControl) return selectedServer.host;
    return undefined;
  });

  // Get user status based on server connection and away status
  const userStatus = useMemo((): PresenceStatus => {
    if (!selectedServer?.isConnected) {
      return "offline";
    }
    if (selectedServer.isAway) {
      return "away";
    }
    return "online";
  }, [selectedServer]);

  // Check if current user is an IRC operator
  // Check both the computed currentUser and the store's currentUser for IRC operator status
  const storeCurrentUser = useStore((state) => state.currentUser);
  const isIrcOp = currentUser?.isIrcOp || storeCurrentUser?.isIrcOp || false;

  // Get channel order from store
  const channelOrder = useStore((state) => state.channelOrder);

  const prevChannelIdRaw = useChannelMru((state) => state.prevItemId);

  const folders = useChannelFolders((state) =>
    selectedServerId ? state.folders[selectedServerId] : undefined,
  );

  const channelEntries = useMemo(() => {
    if (!selectedServer || !selectedServerId) return [];
    const seen = new Set<string>();
    const channels = selectedServer.channels.filter((c) => {
      if (c.isPrivate || seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
    return flattenChannelGroups(
      arrangeChannels(channels, channelOrder[selectedServerId], folders ?? []),
    );
  }, [selectedServer, selectedServerId, channelOrder, folders]);

  const liveCalls = useSyncExternalStore(
    subscribeLiveVoiceCalls,
    getLiveVoiceCalls,
  );
  const isInCall = (channelName: string) =>
    liveCalls.some(
      (call) =>
        call.serverId === selectedServerId &&
        call.channel.toLowerCase() === channelName.toLowerCase(),
    );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset PM click tracking when selection changes
  useEffect(() => {
    setClickedPM(null);
    lastSelectedPM.current = null;
  }, [selectedPrivateChatId]);

  // Sort private chats by order (pinned first, then by order number)
  const sortedPrivateChats = useMemo(() => {
    if (!selectedServer) return [];

    // Deduplicate by lowercase username
    const seen = new Map<string, (typeof selectedServer.privateChats)[0]>();
    for (const pc of selectedServer.privateChats || []) {
      const key = pc.username.toLowerCase();
      const existing = seen.get(key);
      if (
        !existing ||
        (pc.lastActivity?.getTime() ?? 0) >
          (existing.lastActivity?.getTime() ?? 0)
      ) {
        seen.set(key, pc);
      }
    }
    const privateChats = Array.from(seen.values());

    // Sort: pinned chats first (by order), then unpinned chats
    return [...privateChats].sort((a, b) => {
      // Both pinned: sort by order
      if (a.isPinned && b.isPinned) {
        return (a.order || 0) - (b.order || 0);
      }
      // Only a is pinned
      if (a.isPinned) return -1;
      // Only b is pinned
      if (b.isPinned) return 1;
      // Neither pinned: maintain order
      return 0;
    });
  }, [selectedServer]);

  const isTouch = useIsTouchInput();

  const applyChannelDrop = (
    ids: string[],
    draggedId: string,
    targetId: string,
  ) => {
    if (!selectedServerId) return;
    const byId = new Map(channelEntries.map((e) => [e.id, e]));
    const dropped = moveDropIntoFolder(ids, draggedId, targetId).flatMap(
      (id) => byId.get(id) ?? [],
    );
    const layout = readDroppedLayout(dropped, folders ?? []);
    reorderChannels(
      selectedServerId,
      dropped.flatMap((e) => (e.type === "channel" ? [e.id] : [])),
    );
    useChannelFolders.getState().setFolders(selectedServerId, layout.folders);
  };

  const channelDrag = useDragReorder({
    items: channelEntries,
    getItemId: (e) => e.id,
    onReorder: applyChannelDrop,
    disabled: isTouch && !isReordering,
    touchDelay: isReordering ? 0 : undefined,
  });

  // Folder headers only receive drops; dragging one would split it from its channels.
  const dropTargetProps = (id: string): DragRowProps => {
    const {
      onPointerDown: _,
      className,
      ...props
    } = channelDrag.getItemProps(id);
    const isTargeted = className.includes("is-drop-target");
    return {
      ...props,
      className: isTargeted ? "rounded bg-discord-primary/30 text-white" : "",
    };
  };

  const channelDragProps = (id: string): DragRowProps | undefined => {
    if (isTouch && !isReordering) return undefined;
    const props = {
      ...channelDrag.getItemProps(id),
      onPointerMove: channelDrag.handlePointerMove,
      onPointerUp: channelDrag.handlePointerUp,
    };
    if (!isReordering) return props;
    const { onPointerDown: _, ...handleOnly } = props;
    return handleOnly;
  };

  const dragHandle = (id: string) =>
    isReordering ? (
      <button
        type="button"
        className="mr-2 -ml-1 w-8 h-10 flex-shrink-0 flex items-center justify-center text-discord-text-muted touch-none"
        aria-label={t`Drag to move`}
        onPointerDown={(e) => channelDrag.handlePointerDown(e, id)}
        onPointerMove={channelDrag.handlePointerMove}
        onPointerUp={channelDrag.handlePointerUp}
        onClick={(e) => e.stopPropagation()}
      >
        <FaGripVertical />
      </button>
    ) : undefined;

  const pmDrag = useDragReorder({
    items: sortedPrivateChats,
    getItemId: (pm) => pm.id,
    onReorder: (ids) =>
      selectedServerId && reorderPrivateChats(selectedServerId, ids),
  });

  const createFolderAndRename = () => {
    if (!selectedServerId) return;
    setRenamingFolderId(
      useChannelFolders
        .getState()
        .createFolder(selectedServerId, t`new folder`),
    );
  };

  // Only show on Tauri desktop (macOS/Windows/Linux) — not on browser, iOS, or Android
  const prevItemId = isTauriDesktop() ? prevChannelIdRaw : null;
  // Touch :hover fires on tap and shows a misleading blue flash on native mobile
  const nativeMobile = isTauriMobile();
  const hoverPrimary = nativeMobile
    ? ""
    : "hover:bg-discord-primary/70 hover:text-white";
  const hoverSubtle = nativeMobile
    ? ""
    : "hover:bg-discord-dark-100 hover:text-discord-channels-active";

  const pmDragProps = (
    pc: (typeof sortedPrivateChats)[number],
  ): DragRowProps | undefined =>
    pc.isPinned
      ? {
          ...pmDrag.getItemProps(pc.id),
          onPointerMove: pmDrag.handlePointerMove,
          onPointerUp: pmDrag.handlePointerUp,
        }
      : undefined;

  const folderSummaries = summarizeFolders(channelEntries);

  const renderChannelEntries = () => {
    let folder: ChannelFolder | null = null;
    let hasLiveAbove = false;
    return channelEntries.map((entry: ChannelListEntry<Channel>) => {
      if (entry.type === "folder") {
        folder = entry.folder;
        hasLiveAbove = false;
        const folderId = entry.folder.id;
        return (
          <ChannelFolderHeader
            key={entry.id}
            folder={entry.folder}
            summary={folderSummaries.get(folderId)}
            isRenaming={renamingFolderId === folderId}
            drop={dropTargetProps(entry.id)}
            onToggle={() =>
              selectedServerId &&
              useChannelFolders
                .getState()
                .toggleFolderCollapsed(selectedServerId, folderId)
            }
            onOpenMenu={(anchor) =>
              setOpenMenu({ kind: "folder", folderId, anchor })
            }
            onRename={(name) =>
              selectedServerId &&
              useChannelFolders
                .getState()
                .renameFolder(selectedServerId, folderId, name)
            }
            onRenameEnd={() => setRenamingFolderId(null)}
          />
        );
      }
      const channel = entry.channel;
      const isLive = isLiveChannel(channel.name);
      if (isLive && !voiceCapEnabled) return null;
      if (
        folder?.collapsed &&
        !isReordering &&
        channelMenu?.channel.id !== channel.id &&
        channel.id !== selectedChannelId
      )
        return null;
      const isFirstLiveRow = isLive && !hasLiveAbove;
      if (isLive) hasLiveAbove = true;
      return (
        <div
          key={entry.id}
          className={`${folder ? "ml-[9px] pl-2 border-l border-discord-dark-500/60" : ""} ${
            isFirstLiveRow ? "pt-2" : ""
          }`}
        >
          <ChannelRow
            channel={channel}
            serverId={selectedServerId ?? ""}
            isSelected={selectedChannelId === channel.id}
            isPrevious={prevItemId === channel.id}
            isInCall={isInCall(channel.name)}
            isTouch={isTouch}
            hoverClass={hoverPrimary}
            drag={channelDragProps(entry.id)}
            leading={dragHandle(entry.id)}
            onSelect={() =>
              !isReordering && selectChannel(channel.id, { navigate: true })
            }
            onOpenMenu={(anchor) =>
              !isReordering && setOpenMenu({ kind: "channel", channel, anchor })
            }
          />
        </div>
      );
    });
  };

  const menuFolderIndex = (folders ?? []).findIndex(
    (f) => f.id === folderMenu?.folderId,
  );

  const togglePin = (privateChat: { id: string; isPinned?: boolean }) => {
    if (!selectedServerId) return;
    if (privateChat.isPinned)
      unpinPrivateChat(selectedServerId, privateChat.id);
    else pinPrivateChat(selectedServerId, privateChat.id);
  };
  const menuPrivateChat =
    openMenu?.kind === "pm"
      ? sortedPrivateChats.find((pc) => pc.id === openMenu.privateChatId)
      : undefined;

  return (
    <div className="h-full flex flex-col text-discord-channels-default [container-type:inline-size]">
      {/* Server header */}
      <h1 className="h-12 shadow-md flex border-b border-discord-dark-400">
        <button
          type="button"
          disabled={!selectedServer}
          aria-haspopup="menu"
          aria-expanded={!!networkMenuAnchor}
          title={selectedServer ? t`Open network options` : undefined}
          onClick={(e) =>
            setOpenMenu(
              networkMenuAnchor
                ? null
                : { kind: "network", anchor: e.currentTarget },
            )
          }
          className={`flex-1 min-w-0 pl-4 pr-3 flex items-center gap-2 text-left transition-colors enabled:hover:bg-discord-dark-500/30 ${
            networkMenuAnchor ? "bg-discord-dark-500/30" : ""
          }`}
        >
          <span className="flex flex-col min-w-0 flex-1">
            <span className="font-bold text-white truncate">
              {selectedServer?.networkName || selectedServer?.name || "Home"}
            </span>
            {(upstreamSubtitle ||
              (selectedServer?.networkName &&
                selectedServer.name !== selectedServer.networkName)) && (
              <span className="text-xs text-discord-channels-default truncate flex items-center gap-1">
                <span className="truncate">
                  {upstreamSubtitle || selectedServer?.name}
                </span>
                {(selectedServer?.isBouncerControl ||
                  !!selectedServer?.bouncerNetid) && (
                  <span
                    className="inline-flex items-center gap-0.5 bg-discord-dark-300 border border-discord-dark-500 rounded-full px-1 py-0.5 flex-shrink-0"
                    title={
                      selectedServer?.isBouncerControl
                        ? t`soju bouncer (control)`
                        : t`Network bound through soju bouncer`
                    }
                  >
                    <GiGlassShot className="text-amber-300 text-[10px]" />
                    {selectedServer?.isBouncerControl ? (
                      <FaCrown className="text-yellow-400 text-[8px]" />
                    ) : (
                      <FaPlug className="text-sky-300 text-[8px]" />
                    )}
                  </span>
                )}
              </span>
            )}
          </span>
          {selectedServer && (
            <FaChevronDown
              className={`flex-shrink-0 text-xs text-discord-text-normal transition-transform ${
                networkMenuAnchor ? "rotate-180" : ""
              }`}
            />
          )}
        </button>
      </h1>
      {/* Channel list */}
      <div className="flex-grow overflow-y-auto overflow-x-hidden px-2 pt-4 max-w-full">
        {/* Home/Direct Messages view */}
        {!selectedServer && (
          <div className="px-2">
            <div className="text-discord-channels-default font-medium mb-1 text-xs">
              <Trans>HOME</Trans>
            </div>
            <div
              className={`
                px-2 py-1 mb-1 rounded flex items-center gap-2 cursor-pointer
                ${selectedChannelId === null ? "bg-discord-dark-400 text-white" : hoverSubtle}
              `}
              onClick={() => selectChannel(null, { navigate: true })}
            >
              <Trans>Discover</Trans>
            </div>
          </div>
        )}

        {/* Server Channels */}
        {selectedServer && (
          <>
            <ConnectionStrip server={selectedServer} />
            {isReordering ? (
              <div className="flex items-center gap-2 mb-2 px-1">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">
                    <Trans>Reorder channels</Trans>
                  </div>
                  <div className="text-xs">
                    <Trans>
                      Drag a handle to move a channel, or into a folder
                    </Trans>
                  </div>
                </div>
                <button
                  type="button"
                  className="px-3 h-9 rounded-md bg-discord-primary text-white text-sm font-semibold"
                  onClick={() => setIsReordering(false)}
                >
                  <Trans>Done</Trans>
                </button>
              </div>
            ) : (
              <AddChannelRow
                canAddLive={voiceCapEnabled}
                onAdd={(name) =>
                  selectedServerId &&
                  joinAndSelectChannel(selectedServerId, name)
                }
              />
            )}

            {renderChannelEntries()}

            {/* Private Messages */}
            <div className="mt-4 pt-1 mb-2 border-t border-discord-dark-500/50">
              <div className="flex items-center mt-2 mb-1 pl-1">
                <button
                  type="button"
                  aria-expanded={isPrivateChatsOpen}
                  onClick={() => setIsPrivateChatsOpen(!isPrivateChatsOpen)}
                  className="flex items-center gap-1.5 flex-1 min-w-0 h-6 text-left text-xs font-semibold whitespace-nowrap hover:text-discord-text-normal"
                >
                  <span className="truncate">
                    <Trans>Private messages</Trans>
                  </span>
                  <FaChevronRight
                    className={`text-[9px] opacity-70 transition-transform ${
                      isPrivateChatsOpen ? "rotate-90" : ""
                    }`}
                  />
                </button>
              </div>

              {isPrivateChatsOpen && (
                <div>
                  {selectedServerId && (
                    <StartPrivateChatRow serverId={selectedServerId} />
                  )}
                  {sortedPrivateChats.map((privateChat) => (
                    <div
                      key={privateChat.id}
                      onContextMenu={(e) => {
                        if (isTouch) return;
                        e.preventDefault();
                        setOpenMenu({
                          kind: "pm",
                          privateChatId: privateChat.id,
                          anchor: e.currentTarget,
                        });
                      }}
                    >
                      <PrivateChatRow
                        privateChat={privateChat}
                        server={selectedServer}
                        mediaSettings={mediaSettings}
                        isSelected={selectedPrivateChatId === privateChat.id}
                        isPrevious={
                          prevItemId === privateChat.id &&
                          selectedPrivateChatId !== privateChat.id
                        }
                        isTouch={isTouch}
                        hoverClass={hoverPrimary}
                        drag={pmDragProps(privateChat)}
                        onSelect={() => {
                          if (lastSelectedPM.current === privateChat.id) return;
                          lastSelectedPM.current = privateChat.id;
                          selectPrivateChat(privateChat.id, { navigate: true });
                        }}
                        onLongPressSelect={() =>
                          selectPrivateChat(privateChat.id, {
                            navigate: false,
                          })
                        }
                        onPinToggle={() => togglePin(privateChat)}
                        onDelete={() =>
                          selectedServerId &&
                          deletePrivateChat(selectedServerId, privateChat.id)
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-3 mb-2 border-t border-discord-dark-500/50">
              <div
                className={`
                  px-2 min-h-10 rounded-md flex items-center gap-2 cursor-pointer shadow-sm
                  transition-all duration-200 ease-in-out
                  ${selectedChannelId === "server-notices" ? "bg-black text-white" : `bg-discord-dark-400/50 ${hoverPrimary}`}
                `}
                onClick={() =>
                  selectChannel("server-notices", { navigate: true })
                }
              >
                <span className="w-6 flex justify-center flex-shrink-0">
                  <FaCommentDots className="text-lg" />
                </span>
                <span className="truncate font-medium">
                  <Trans>Server Notices</Trans>
                </span>
              </div>
            </div>
          </>
        )}
      </div>
      <UserPanel
        serverId={selectedServerId}
        username={currentUser?.username || "User"}
        avatarUrl={
          canShowAvatarUrl(
            currentUser?.metadata?.avatar?.value,
            serverFilehosts(selectedServer),
            mediaSettings,
          )
            ? currentUser?.metadata?.avatar?.value
            : undefined
        }
        status={userStatus}
        awayMessage={selectedServer?.awayMessage}
        displayName={currentUser?.metadata?.["display-name"]?.value}
        customStatus={currentUser?.metadata?.status?.value}
        pronouns={currentUser?.metadata?.pronouns?.value}
        networkName={selectedServer?.networkName ?? selectedServer?.name}
        isIrcOp={isIrcOp}
        onOpenSettings={() => toggleSettingsModal(true)}
      />
      {selectedServerId && (
        <>
          <Menu
            isOpen={!!menuPrivateChat}
            anchorElement={openMenu?.kind === "pm" ? openMenu.anchor : null}
            onClose={closeMenu}
            placement="side"
            menuItems={
              menuPrivateChat
                ? [
                    {
                      id: "pin",
                      label: menuPrivateChat.isPinned
                        ? t`Unpin Private Chat`
                        : t`Pin Private Chat`,
                      icon: <FaThumbtack />,
                      onClick: () => togglePin(menuPrivateChat),
                    },
                    {
                      id: "delete",
                      label: t`Delete Private Chat`,
                      icon: <FaTrash />,
                      danger: true,
                      onClick: () =>
                        deletePrivateChat(selectedServerId, menuPrivateChat.id),
                    },
                  ]
                : []
            }
          />
          <NetworkMenu
            serverId={selectedServerId}
            anchor={networkMenuAnchor}
            isTouch={isTouch}
            onClose={closeMenu}
            onNewFolder={createFolderAndRename}
            onReorder={() => setIsReordering(true)}
          />
          {channelMenu && (
            <ChannelContextMenu
              serverId={selectedServerId}
              channel={channelMenu.channel}
              anchor={channelMenu.anchor}
              onClose={closeMenu}
              onInvite={() =>
                setModalChannel({
                  name: channelMenu.channel.name,
                  modal: "invite",
                })
              }
              onOpenSettings={() =>
                setModalChannel({
                  name: channelMenu.channel.name,
                  modal: "settings",
                })
              }
              onNewFolder={setRenamingFolderId}
              onReorder={isTouch ? () => setIsReordering(true) : undefined}
            />
          )}
          <Menu
            isOpen={!!folderMenu}
            anchorElement={folderMenu?.anchor ?? null}
            onClose={closeMenu}
            menuItems={
              folderMenu
                ? [
                    {
                      id: "rename",
                      label: t`Rename folder`,
                      icon: <FaPen />,
                      show: true,
                      onClick: () => setRenamingFolderId(folderMenu.folderId),
                    },
                    {
                      id: "up",
                      label: t`Move folder up`,
                      icon: <FaArrowUp />,
                      show: menuFolderIndex > 0,
                      onClick: () =>
                        useChannelFolders
                          .getState()
                          .moveFolder(
                            selectedServerId,
                            folderMenu.folderId,
                            -1,
                          ),
                    },
                    {
                      id: "down",
                      label: t`Move folder down`,
                      icon: <FaArrowDown />,
                      show: menuFolderIndex < (folders?.length ?? 0) - 1,
                      onClick: () =>
                        useChannelFolders
                          .getState()
                          .moveFolder(selectedServerId, folderMenu.folderId, 1),
                    },
                    {
                      id: "delete",
                      label: t`Delete folder`,
                      icon: <FaTrash />,
                      show: true,
                      divider: true,
                      danger: true,
                      onClick: () =>
                        useChannelFolders
                          .getState()
                          .deleteFolder(selectedServerId, folderMenu.folderId),
                    },
                  ]
                : []
            }
          />
          {modalChannel && (
            <>
              <ChannelSettingsModal
                isOpen={modalChannel.modal === "settings"}
                onClose={() => setModalChannel(null)}
                serverId={selectedServerId}
                channelName={modalChannel.name}
              />
              <InviteUserModal
                isOpen={modalChannel.modal === "invite"}
                onClose={() => setModalChannel(null)}
                serverId={selectedServerId}
                channelName={modalChannel.name}
              />
            </>
          )}
        </>
      )}
    </div>
  );
};

export default ChannelList;
