import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useMemo } from "react";
import { FaChevronLeft, FaCircle, FaTimes } from "react-icons/fa";
import ircClient from "../../lib/ircClient";
import { confirmDestructive } from "../../lib/modal/ConfirmDialog";
import useStore from "../../store";
import type { BotPane as BotPaneTarget } from "../../store/types";
import type { BotCommand, PushBotInfo } from "../../types";
import LoadingSpinner from "../ui/LoadingSpinner";

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
      title: t`Server-wide bot, reachable from any channel`,
      cls: SCOPE_CLS.server,
    },
    channel: {
      label: t`channel`,
      title: t`Channel bot, only in joined channels`,
      cls: SCOPE_CLS.channel,
    },
  };
}

interface BotDetailProps {
  bot: PushBotInfo;
  isOper: boolean;
  loading?: boolean;
  onAction: (subcmd: string) => void;
  onPickCommand: (command: BotCommand) => void;
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
              {bot.channels.length ? bot.channels.join(", ") : "-"}
            </dd>
          </>
        )}
        {bot.webhook_url !== undefined && (
          <>
            <dt className="text-discord-text-muted">
              <Trans>Webhook</Trans>
            </dt>
            <dd className="text-discord-text-normal break-all">
              {bot.webhook_url || "-"}
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
              <Trans>No slash commands yet</Trans>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {bot.commands.map((cmd) => (
              <li key={cmd.name}>
                <button
                  type="button"
                  onClick={() => onPickCommand(cmd)}
                  className="w-full text-left bg-discord-dark-400 hover:bg-discord-dark-500 rounded px-3 py-2 transition-colors"
                >
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
                </button>
              </li>
            ))}
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
              onClick={async () => {
                if (
                  await confirmDestructive(
                    t`Delete bot`,
                    t`Delete bot ${bot.nick}? Run /REHASH before you register this nick again.`,
                    t`Delete`,
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

// We only reach a channel bot through a channel we share with it, so we hide it once we part those channels.
function isBotReachable(
  bot: PushBotInfo,
  isOper: boolean,
  joinedChannels: Set<string>,
): boolean {
  if (isOper || bot.scope === "server") return true;
  return !!bot.channels?.some((ch) => joinedChannels.has(ch.toLowerCase()));
}

export const BotPane: React.FC<{ target: BotPaneTarget }> = ({ target }) => {
  const { serverId, botNick } = target;
  const server = useStore((s) => s.servers.find((srv) => srv.id === serverId));
  const currentUser = useStore((s) => s.currentUser);
  const isNarrowView = useStore((s) => s.ui.isNarrowView);
  const closeProfile = useStore((s) => s.closeProfile);
  const openBot = useStore((s) => s.openBot);
  const requestBotCommandPick = useStore((s) => s.requestBotCommandPick);

  const isOper = !!server?.users.find(
    (u) => u.username === currentUser?.username,
  )?.isIrcOp;

  const bots: PushBotInfo[] = useMemo(() => {
    const joinedChannels = new Set(
      (server?.channels ?? []).map((c) => c.name.toLowerCase()),
    );
    return Object.values(server?.bots ?? {})
      .filter((b) => isBotReachable(b, isOper, joinedChannels))
      .sort((a, b) => a.nick.localeCompare(b.nick));
  }, [server?.bots, server?.channels, isOper]);

  const selected = botNick ? server?.bots?.[botNick.toLowerCase()] : undefined;

  const send = (subcmd: string) => {
    if (!isOper || !selected) return;
    ircClient.sendRaw(serverId, `PUSHBOT ${subcmd} ${selected.nick}`);
    if (subcmd === "DELETE") openBot(serverId);
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-x-hidden bg-discord-dark-100">
      <header className="h-12 shrink-0 flex items-center gap-1.5 px-2 border-b border-white/[0.06]">
        {(isNarrowView || selected) && (
          <button
            type="button"
            onClick={selected ? () => openBot(serverId) : closeProfile}
            className="icon-button w-10 h-10 rounded-lg"
            title={t`Back`}
            aria-label={t`Back`}
          >
            <FaChevronLeft className="w-3.5 h-3.5" />
          </button>
        )}
        <h2 className="flex-1 min-w-0 truncate px-1 text-[15px] font-semibold text-white">
          <Trans>Bots</Trans>
        </h2>
        {!isNarrowView && (
          <button
            type="button"
            onClick={closeProfile}
            className="icon-button w-10 h-10 rounded-lg"
            title={t`Close`}
            aria-label={t`Close`}
          >
            <FaTimes className="w-3.5 h-3.5" />
          </button>
        )}
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-4">
        {selected ? (
          <BotDetail
            bot={selected}
            isOper={isOper}
            loading={
              !!server?.botCommandsLoading?.includes(
                selected.nick.toLowerCase(),
              )
            }
            onAction={send}
            onPickCommand={(cmd) => {
              requestBotCommandPick(serverId, selected.nick, cmd);
              closeProfile();
            }}
          />
        ) : bots.length === 0 ? (
          <div className="py-8 text-center text-sm text-discord-text-muted">
            <Trans>No bots registered on this network yet.</Trans>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {bots.map((b) => (
              <li key={b.nick}>
                <button
                  type="button"
                  onClick={() => openBot(serverId, b.nick)}
                  className="w-full text-left flex items-center gap-2 rounded px-3 py-2 text-discord-text-normal hover:bg-discord-dark-400 transition-colors"
                >
                  {server?.botCommandsLoading?.includes(
                    b.nick.toLowerCase(),
                  ) ? (
                    <LoadingSpinner size="sm" text="" />
                  ) : (
                    <FaCircle
                      className={`text-[8px] ${b.online ? "text-emerald-400" : "text-discord-text-muted/60"}`}
                    />
                  )}
                  <span className="truncate">{b.nick}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default BotPane;
