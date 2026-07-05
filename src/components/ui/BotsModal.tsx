// Bot management modal — directory view of the obby.world/channel-bots
// cap state.  Mirrors UserSettings' layout: desktop = backdrop + centered
// card with a left sidebar (filterable bot list) and right content pane
// (selected bot's detail); mobile = full-screen portal with a two-view
// drill-in (list → detail, back button to return).
//
// Bot lifecycle pushes from the IRCd land in server.bots; this modal is
// a pure read of that map plus a few send-and-forget /PUSHBOT subcommand
// buttons for IRCops.

import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FaChevronLeft, FaCircle, FaRobot, FaTimes } from "react-icons/fa";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useModalBehavior } from "../../hooks/useModalBehavior";
import ircClient from "../../lib/ircClient";
import useStore from "../../store";
import type { BotCommand, PushBotInfo } from "../../types";
import LoadingSpinner from "./LoadingSpinner";

interface BotsModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverId: string;
  /** Invoked when the user clicks one of the bot's slash commands.
   *  ChatArea opens the slash-command param modal in response. */
  onPickCommand?: (botNick: string, command: BotCommand) => void;
  /** Nick to focus when the modal opens.  Used by deep-links from
   *  the member-list bot popover ("Show in Bots Menu") so the
   *  selected bot's command list is the first thing visible. */
  preselectNick?: string | null;
}

type FilterMode = "all" | "server" | "channel";

// Module-scope colour classes — these never change per locale so they
// stay literals.  Labels and tooltips are built at render time via
// useStatusBadge / useScopeBadge / useFilterLabels so the t macro fires
// after i18n.activate has run.

const STATUS_CLS: Record<PushBotInfo["status"], string> = {
  active: "bg-emerald-700/40 text-emerald-300 border border-emerald-600/50",
  pending: "bg-amber-700/40 text-amber-300 border border-amber-600/50",
  suspended: "bg-red-700/40 text-red-300 border border-red-600/50",
  deleted:
    "bg-discord-dark-400 text-discord-text-muted border border-discord-dark-500",
};

const SCOPE_CLS: Record<PushBotInfo["scope"], string> = {
  server:
    "bg-discord-primary/30 text-discord-primary border border-discord-primary/40",
  channel: "bg-amber-700/30 text-amber-300 border border-amber-600/40",
};

function useStatusBadge(): Record<
  PushBotInfo["status"],
  { label: string; cls: string }
> {
  const { t } = useLingui();
  return {
    active: { label: t`active`, cls: STATUS_CLS.active },
    pending: { label: t`pending`, cls: STATUS_CLS.pending },
    suspended: { label: t`suspended`, cls: STATUS_CLS.suspended },
    deleted: { label: t`deleted`, cls: STATUS_CLS.deleted },
  };
}

function useScopeBadge(): Record<
  PushBotInfo["scope"],
  { label: string; title: string; cls: string }
> {
  const { t } = useLingui();
  return {
    server: {
      label: t`server`,
      title: t`Server-wide bot — reachable from any channel`,
      cls: SCOPE_CLS.server,
    },
    channel: {
      label: t`channel`,
      title: t`Channel bot — only in joined channels`,
      cls: SCOPE_CLS.channel,
    },
  };
}

function useFilterLabels(): Record<FilterMode, string> {
  const { t } = useLingui();
  return {
    all: t`All`,
    server: t`Server-wide`,
    channel: t`Channel`,
  };
}

// ── child components ──────────────────────────────────────────────────

interface BotRowProps {
  bot: PushBotInfo;
  selected: boolean;
  loading?: boolean;
  onSelect: () => void;
}

const BotRow: React.FC<BotRowProps> = ({
  bot,
  selected,
  loading,
  onSelect,
}) => {
  const STATUS_BADGE = useStatusBadge();
  const SCOPE_BADGE = useScopeBadge();
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 mb-1 rounded transition-colors overflow-hidden ${
        selected
          ? "bg-discord-primary text-white"
          : "text-discord-text-muted hover:text-white hover:bg-discord-dark-400"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <FaCircle
          className={`text-[8px] flex-shrink-0 ${
            bot.online ? "text-emerald-400" : "text-discord-text-muted/60"
          }`}
          title={bot.online ? t`Gateway connected` : t`Offline`}
        />
        <span className="font-mono text-sm truncate">{bot.nick}</span>
        {loading && (
          <span
            className="ml-1 inline-flex flex-shrink-0"
            title={t`Receiving command list…`}
          >
            <LoadingSpinner size="sm" text="" />
          </span>
        )}
        <span
          className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide flex-shrink-0 ${SCOPE_BADGE[bot.scope].cls}`}
          title={SCOPE_BADGE[bot.scope].title}
        >
          {SCOPE_BADGE[bot.scope].label}
        </span>
      </div>
      {bot.status !== "active" && (
        <div className="mt-1">
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${STATUS_BADGE[bot.status].cls}`}
          >
            {STATUS_BADGE[bot.status].label}
          </span>
        </div>
      )}
      {bot.realname && (
        <div
          className={`text-xs mt-0.5 truncate ${selected ? "text-white/80" : "text-discord-text-muted"}`}
        >
          {bot.realname}
        </div>
      )}
    </button>
  );
};

interface BotDetailProps {
  bot: PushBotInfo;
  isOper: boolean;
  loading?: boolean;
  onAction: (subcmd: string) => void;
  onPickCommand?: (command: BotCommand) => void;
}

const BotDetail: React.FC<BotDetailProps> = ({
  bot,
  isOper,
  loading,
  onAction,
  onPickCommand,
}) => {
  const STATUS_BADGE = useStatusBadge();
  const SCOPE_BADGE = useScopeBadge();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h3 className="text-white text-xl font-bold">{bot.nick}</h3>
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${SCOPE_BADGE[bot.scope].cls}`}
        >
          {SCOPE_BADGE[bot.scope].label}
        </span>
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${STATUS_BADGE[bot.status].cls}`}
        >
          {STATUS_BADGE[bot.status].label}
        </span>
        <span
          className={`flex items-center gap-1 text-xs ${
            bot.online ? "text-emerald-400" : "text-discord-text-muted"
          }`}
        >
          <FaCircle className="text-[8px]" />
          {bot.online ? t`gateway online` : t`offline`}
        </span>
      </div>
      {bot.realname && (
        <div className="text-sm text-discord-text-muted">{bot.realname}</div>
      )}

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-discord-text-muted">
          <Trans>Transport</Trans>
        </dt>
        <dd className="text-discord-text-normal font-mono">{bot.transport}</dd>
        <dt className="text-discord-text-muted">
          <Trans>Source</Trans>
        </dt>
        <dd className="text-discord-text-normal">
          {bot.from_config ? t`config-defined` : t`self-registered`}
        </dd>
        {bot.scope === "channel" && (
          <>
            <dt className="text-discord-text-muted">
              <Trans>Channels</Trans>
            </dt>
            <dd className="text-discord-text-normal font-mono break-words">
              {bot.channels.length ? bot.channels.join(", ") : "—"}
            </dd>
          </>
        )}
        {bot.webhook_url !== undefined && (
          <>
            <dt className="text-discord-text-muted">
              <Trans>Webhook</Trans>
            </dt>
            <dd className="text-discord-text-normal break-all">
              {bot.webhook_url || "—"}
              {bot.webhook_suspended && (
                <span className="ml-2 text-red-400 text-xs">
                  <Trans>(suspended)</Trans>
                </span>
              )}
            </dd>
          </>
        )}
      </dl>

      <div>
        <h4 className="text-discord-text-muted text-xs font-semibold uppercase tracking-wide mb-2">
          <Trans>Slash commands</Trans>
        </h4>
        {bot.commands.length === 0 ? (
          <div className="text-sm text-discord-text-muted italic flex items-center gap-2">
            {loading ? (
              <>
                <LoadingSpinner size="sm" text="" />
                <Trans>Commands are loading…</Trans>
              </>
            ) : (
              <Trans>Bot hasn't registered any slash commands yet.</Trans>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {bot.commands.map((cmd) => {
              const body = (
                <>
                  <div className="font-mono text-sm text-discord-text-normal">
                    /{cmd.name}
                    {(cmd.options ?? []).map((o) => (
                      <span
                        key={o.name}
                        className="ml-1 text-discord-text-muted text-xs"
                      >
                        {o.required ? `<${o.name}>` : `[${o.name}]`}
                      </span>
                    ))}
                  </div>
                  {cmd.description && (
                    <div className="text-xs text-discord-text-muted mt-1">
                      {cmd.description}
                    </div>
                  )}
                </>
              );
              return onPickCommand ? (
                <li key={cmd.name}>
                  <button
                    type="button"
                    onClick={() => onPickCommand(cmd)}
                    className="w-full text-left bg-discord-dark-400 hover:bg-discord-dark-500 rounded px-3 py-2 transition-colors"
                  >
                    {body}
                  </button>
                </li>
              ) : (
                <li
                  key={cmd.name}
                  className="bg-discord-dark-400 rounded px-3 py-2"
                >
                  {body}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {isOper && !bot.from_config && (
        <div className="border-t border-discord-dark-500 pt-3">
          <h4 className="text-discord-text-muted text-xs font-semibold uppercase tracking-wide mb-2">
            <Trans>Operator actions</Trans>
          </h4>
          <div className="flex gap-2 flex-wrap">
            {bot.status === "pending" && (
              <button
                type="button"
                onClick={() => onAction("APPROVE")}
                className="bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 rounded text-sm transition-colors"
              >
                <Trans>Approve</Trans>
              </button>
            )}
            {bot.status === "active" && (
              <button
                type="button"
                onClick={() => onAction("SUSPEND")}
                className="bg-amber-700 hover:bg-amber-600 text-white px-3 py-1.5 rounded text-sm transition-colors"
              >
                <Trans>Suspend</Trans>
              </button>
            )}
            {bot.status === "suspended" && (
              <button
                type="button"
                onClick={() => onAction("UNSUSPEND")}
                className="bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 rounded text-sm transition-colors"
              >
                <Trans>Unsuspend</Trans>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    t`Delete bot ${bot.nick}?  This soft-deletes the database row; reuse the nick later only after a /REHASH.`,
                  )
                ) {
                  onAction("DELETE");
                }
              }}
              className="bg-red-700 hover:bg-red-600 text-white px-3 py-1.5 rounded text-sm transition-colors"
            >
              <Trans>Delete</Trans>
            </button>
          </div>
        </div>
      )}
      {isOper && bot.from_config && (
        <div className="text-xs text-discord-text-muted italic border-t border-discord-dark-500 pt-3">
          <Trans>
            Config-defined bot. Edit obbyircd.conf and /REHASH to change state.
          </Trans>
        </div>
      )}
    </div>
  );
};

// ── main modal ────────────────────────────────────────────────────────

const BotsModal: React.FC<BotsModalProps> = ({
  isOpen,
  onClose,
  serverId,
  onPickCommand,
  preselectNick,
}) => {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const server = useStore((s) => s.servers.find((srv) => srv.id === serverId));
  const currentUser = useStore((s) => s.currentUser);
  const FILTER_LABELS = useFilterLabels();
  const [filter, setFilter] = useState<FilterMode>("all");
  const [query, setQuery] = useState("");
  const [selectedNick, setSelectedNick] = useState<string | null>(
    preselectNick ?? null,
  );
  const [mobileView, setMobileView] = useState<"list" | "detail">(
    preselectNick ? "detail" : "list",
  );
  useEffect(() => {
    if (isOpen && preselectNick) {
      setSelectedNick(preselectNick);
      setMobileView("detail");
    }
  }, [isOpen, preselectNick]);

  const { getBackdropProps, getContentProps } = useModalBehavior({
    onClose,
    isOpen,
  });

  const isOper = (() => {
    const myNick = currentUser?.username;
    if (!myNick || !server) return false;
    const me = server.users.find((u) => u.username === myNick);
    return !!me?.isIrcOp;
  })();

  const bots: PushBotInfo[] = useMemo(() => {
    if (!server?.bots) return [];
    // Reachability filter: server-scope bots are always shown
    // (reachable from any context).  Channel-scope bots only appear
    // when the local user still shares a channel with them -- this
    // matches the server-side discovery contract (server-scope on
    // burst, channel-scope on LOCAL_JOIN of a shared channel) and
    // hides stale entries left over after the user parts a channel.
    const joinedChannels = new Set(
      (server.channels ?? []).map((c) => c.name.toLowerCase()),
    );
    const reachable = (b: PushBotInfo) => {
      // Opers manage bots they may not share a channel with; don't
      // hide channel-scope entries from them.
      if (isOper) return true;
      if (b.scope === "server") return true;
      if (!b.channels?.length) return false;
      return b.channels.some((ch) => joinedChannels.has(ch.toLowerCase()));
    };
    const all = Object.values(server.bots);
    return all
      .filter(reachable)
      .filter((b) => filter === "all" || b.scope === filter)
      .filter((b) =>
        query
          ? b.nick.toLowerCase().includes(query.toLowerCase()) ||
            (b.realname ?? "").toLowerCase().includes(query.toLowerCase())
          : true,
      )
      .sort((a, b) => {
        const sa = a.status === "active" ? 0 : a.status === "pending" ? 1 : 2;
        const sb = b.status === "active" ? 0 : b.status === "pending" ? 1 : 2;
        if (sa !== sb) return sa - sb;
        return a.nick.localeCompare(b.nick);
      });
  }, [server?.bots, server?.channels, filter, query, isOper]);

  const selected = selectedNick
    ? server?.bots?.[selectedNick.toLowerCase()]
    : undefined;

  const send = (subcmd: string) => {
    if (!isOper || !selected) return;
    ircClient.sendRaw(serverId, `PUSHBOT ${subcmd} ${selected.nick}`);
    if (subcmd === "DELETE") {
      setSelectedNick(null);
      if (isMobile) setMobileView("list");
    }
  };

  const onPickBot = (nick: string) => {
    setSelectedNick(nick);
    if (isMobile) setMobileView("detail");
  };

  if (!isOpen) return null;

  // ── list-pane content, shared between mobile and desktop ────────────
  const listPane = (
    <>
      <div className="p-3 border-b border-discord-dark-500 flex flex-col gap-2 flex-shrink-0">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t`Search bots`}
          className="w-full bg-discord-dark-400 rounded px-2 py-1.5 text-sm text-discord-text-normal placeholder:text-discord-text-muted border border-discord-dark-300 focus:outline-none focus:border-discord-primary"
        />
        <div className="flex gap-1 text-xs">
          {(["all", "server", "channel"] as FilterMode[]).map((f) => (
            <button
              type="button"
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded transition-colors ${
                filter === f
                  ? "bg-discord-primary text-white"
                  : "bg-discord-dark-400 text-discord-text-muted hover:text-white"
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
          <div className="ml-auto text-discord-text-muted self-center">
            {bots.length}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {bots.length === 0 ? (
          <div className="p-4 text-sm text-discord-text-muted text-center">
            <Trans>No bots registered on this network yet.</Trans>
          </div>
        ) : (
          bots.map((b) => (
            <BotRow
              key={b.bot_id || b.nick}
              bot={b}
              selected={selectedNick?.toLowerCase() === b.nick.toLowerCase()}
              loading={
                server?.botCommandsLoading?.includes(b.nick.toLowerCase()) ??
                false
              }
              onSelect={() => onPickBot(b.nick)}
            />
          ))
        )}
      </div>
    </>
  );

  const detailPane = selected ? (
    <BotDetail
      bot={selected}
      isOper={isOper}
      loading={
        !!server?.botCommandsLoading?.includes(selected.nick.toLowerCase())
      }
      onAction={send}
      onPickCommand={
        onPickCommand
          ? (cmd) => {
              onPickCommand(selected.nick, cmd);
              onClose();
            }
          : undefined
      }
    />
  ) : (
    <div className="m-auto text-sm text-discord-text-muted text-center max-w-sm">
      <FaRobot className="text-4xl text-discord-text-muted/60 mx-auto mb-3" />
      <Trans>
        Select a bot on the left to see its commands and management actions.
      </Trans>
    </div>
  );

  // ── mobile: full-screen portal with two views ──────────────────────
  if (isMobile) {
    const portalTarget = document.getElementById("root") || document.body;
    return createPortal(
      <div
        className="fixed inset-0 z-[9999] bg-discord-dark-200 flex flex-col animate-in fade-in"
        style={{
          paddingTop: "var(--safe-area-inset-top, 0px)",
          paddingBottom: "var(--safe-area-inset-bottom, 0px)",
          paddingLeft: "var(--safe-area-inset-left, 0px)",
          paddingRight: "var(--safe-area-inset-right, 0px)",
        }}
      >
        {mobileView === "list" ? (
          <>
            <div className="flex items-center justify-between p-4 border-b border-discord-dark-500 flex-shrink-0">
              <h2 className="text-white text-lg font-semibold flex items-center gap-2">
                <FaRobot className="text-discord-text-muted" />
                <Trans>Bots</Trans>
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-discord-dark-400 text-discord-text-muted hover:text-white"
                aria-label={t`Close`}
              >
                <FaTimes />
              </button>
            </div>
            {listPane}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between p-4 border-b border-discord-dark-500 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setMobileView("list")}
                  className="p-1 rounded-lg hover:bg-discord-dark-400 text-discord-text-muted hover:text-white flex-shrink-0"
                  aria-label={t`Back`}
                >
                  <FaChevronLeft />
                </button>
                <h2 className="text-white text-lg font-semibold truncate">
                  {selected?.nick ?? t`Bot`}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-discord-dark-400 text-discord-text-muted hover:text-white"
                aria-label={t`Close`}
              >
                <FaTimes />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{detailPane}</div>
          </>
        )}
      </div>,
      portalTarget,
    );
  }

  // ── desktop: backdrop + centered card with sidebar + content ───────
  const portalTarget = document.getElementById("root") || document.body;
  return createPortal(
    <div
      {...getBackdropProps()}
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[9999] modal-container"
    >
      <div
        {...getContentProps()}
        className="bg-discord-dark-200 rounded-lg w-full max-w-4xl h-[80vh] flex overflow-hidden"
      >
        {/* Sidebar — list of bots */}
        <div className="bg-discord-dark-300 flex flex-col w-72 flex-shrink-0">
          <div className="p-4 border-b border-discord-dark-500 flex items-center justify-center gap-2 flex-shrink-0">
            <FaRobot className="text-white" />
            <h2 className="text-white text-base font-bold">
              <Trans>Bots</Trans>
            </h2>
          </div>
          {listPane}
        </div>

        {/* Main content — bot detail */}
        <div className="flex-1 flex flex-col bg-discord-dark-200">
          <div className="flex justify-between items-center p-4 border-b border-discord-dark-500 flex-shrink-0">
            <h3 className="text-white text-lg font-semibold truncate">
              {selected ? selected.nick : t`Bots on this network`}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-discord-text-muted hover:text-white"
              aria-label={t`Close`}
            >
              <FaTimes />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6 flex">
            <div className="w-full">{detailPane}</div>
          </div>
        </div>
      </div>
    </div>,
    portalTarget,
  );
};

export default BotsModal;
