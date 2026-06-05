/**
 * Invitations management panel.
 *
 * Lets a logged-in user (registered account, when the server gates
 * via set::invitation::require-registered) view, create, and delete
 * the invite share-ids issued under their account.  Speaks the
 * obbyircd INVITELINK protocol; the panel only mounts when the
 * active server has negotiated `obby.world/invitation`.
 *
 * Wire (server-side spec: obbyircd src/modules/invitation.c):
 *   INVITELINK LIST                           -> stream of ENTRY rows
 *   INVITELINK CREATE [<channel>] [:<descr>]  -> one INVITELINK row
 *   INVITELINK DELETE <share-id>              -> NOTE DELETED or FAIL
 */
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  FaCheck,
  FaCopy,
  FaExclamationTriangle,
  FaHashtag,
  FaPlus,
  FaSync,
  FaTrash,
} from "react-icons/fa";
import useStore from "../../store";

interface Props {
  /** Active server's ID. `undefined` when no server is selected
   * (e.g. the user opened settings from the home / discover page);
   * the panel renders a "select a server" placeholder in that case. */
  serverId: string | undefined;
}

const formatRelative = (iso: string): string => {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return iso;
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return t`just now`;
  if (secs < 3600) return t`${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return t`${Math.floor(secs / 3600)}h ago`;
  return t`${Math.floor(secs / 86400)}d ago`;
};

const InvitationsPanel: React.FC<Props> = ({ serverId }) => {
  const server = useStore((s) =>
    serverId ? s.servers.find((srv) => srv.id === serverId) : undefined,
  );
  const cap = server?.capabilities?.includes("obby.world/invitation");
  const data = useStore((s) =>
    serverId ? s.inviteLinks[serverId] : undefined,
  );
  const loadInvitations = useStore((s) => s.loadInvitations);
  const createInvitation = useStore((s) => s.createInvitation);
  const deleteInvitation = useStore((s) => s.deleteInvitation);

  const [channel, setChannel] = useState("");
  const [description, setDescription] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // Initial load.  We re-fetch when the cap status flips so a server
  // reconnect that re-acks the cap pulls fresh data.
  // biome-ignore lint/correctness/useExhaustiveDependencies: store actions have unstable refs
  useEffect(() => {
    if (serverId && cap) loadInvitations(serverId);
  }, [serverId, cap]);

  const sortedEntries = useMemo(() => {
    if (!data?.entries) return [];
    return [...data.entries].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return tb - ta;
    });
  }, [data?.entries]);

  if (!serverId || !server) {
    return (
      <div className="rounded-lg bg-discord-dark-400 p-4 text-sm text-discord-text-muted">
        <Trans>
          No server is selected. Pick a server from the sidebar first; invite
          links are managed per-server.
        </Trans>
      </div>
    );
  }

  if (!cap) {
    return (
      <div className="rounded-lg bg-discord-dark-400 p-4 text-sm text-discord-text-muted">
        <Trans>
          This server doesn't support invite links (the
          <code className="font-mono text-xs mx-1">obby.world/invitation</code>
          capability isn't advertised). You can still chat normally; this panel
          is for obbyircd-powered networks.
        </Trans>
      </div>
    );
  }

  const handleCreate = () => {
    const ch = channel.trim();
    const desc = description.trim();
    if (ch && !"#&^$".includes(ch.charAt(0))) {
      // tolerate "weather" → "#weather"
      createInvitation(serverId, `#${ch}`, desc || undefined);
    } else {
      createInvitation(serverId, ch || undefined, desc || undefined);
    }
    setChannel("");
    setDescription("");
  };

  const handleCopy = async (url: string, shareId: string) => {
    try {
      await navigator.clipboard?.writeText(url);
      setCopiedId(shareId);
      setTimeout(() => {
        setCopiedId((current) => (current === shareId ? null : current));
      }, 1500);
    } catch {
      /* clipboard blocked -- ignore; the URL is still selectable */
    }
  };

  const handleDelete = (shareId: string) => {
    if (pendingDelete === shareId) {
      deleteInvitation(serverId, shareId);
      setPendingDelete(null);
    } else {
      setPendingDelete(shareId);
      setTimeout(() => {
        setPendingDelete((current) => (current === shareId ? null : current));
      }, 4000);
    }
  };

  return (
    <div className="space-y-4">
      {/* Create form */}
      <div className="rounded-lg bg-discord-dark-300 p-4">
        <h3 className="text-sm font-semibold text-white mb-3">
          <Trans>Create a new invite link</Trans>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-2 items-stretch">
          <input
            type="text"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder={t`#channel (optional)`}
            className="bg-discord-dark-400 text-white rounded px-3 py-2 text-sm border border-discord-dark-300 focus:outline-none focus:border-discord-primary placeholder:text-discord-text-muted/70"
            maxLength={64}
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t`Description (optional, e.g. "Beta testers Q3")`}
            className="bg-discord-dark-400 text-white rounded px-3 py-2 text-sm border border-discord-dark-300 focus:outline-none focus:border-discord-primary placeholder:text-discord-text-muted/70"
            maxLength={200}
          />
          <button
            type="button"
            onClick={handleCreate}
            className="bg-discord-primary hover:bg-discord-primary/90 text-white rounded px-4 py-2 text-sm font-semibold inline-flex items-center justify-center gap-1.5"
          >
            <FaPlus size={11} />
            <Trans>Create</Trans>
          </button>
        </div>
        <p className="text-[11px] text-discord-text-muted mt-2">
          <Trans>
            Leave channel blank for a generic network invite. Description is
            just for your records — visible only to you in this list.
          </Trans>
        </p>
      </div>

      {/* Header + refresh */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">
          <Trans>Your invite links</Trans>
          {data && (
            <span className="text-discord-text-muted font-normal ml-1.5">
              ({sortedEntries.length})
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => loadInvitations(serverId)}
          disabled={data?.loading}
          className="text-discord-text-muted hover:text-white text-xs inline-flex items-center gap-1 disabled:opacity-50"
          title={t`Refresh`}
        >
          <FaSync size={10} className={data?.loading ? "animate-spin" : ""} />
          <Trans>Refresh</Trans>
        </button>
      </div>

      {/* Error */}
      {data?.error && (
        <div className="rounded-lg bg-red-900/30 border border-red-700/40 p-3 text-sm text-red-200 inline-flex items-start gap-2">
          <FaExclamationTriangle
            size={12}
            className="text-red-400 mt-0.5 flex-shrink-0"
          />
          <span>{data.error}</span>
        </div>
      )}

      {/* Empty state */}
      {!data?.loading && sortedEntries.length === 0 && !data?.error && (
        <div className="rounded-lg bg-discord-dark-400 p-6 text-center text-sm text-discord-text-muted">
          <Trans>
            You haven't created any invite links yet. Use the form above to mint
            your first one.
          </Trans>
        </div>
      )}

      {/* Entries */}
      <div className="space-y-2">
        {sortedEntries.map((entry) => (
          <div
            key={entry.shareId}
            className="rounded-lg bg-discord-dark-300 p-3 flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {entry.channel ? (
                  <span className="inline-flex items-center gap-1 bg-discord-dark-400 text-white text-xs font-mono px-2 py-0.5 rounded">
                    <FaHashtag size={9} className="text-discord-text-muted" />
                    {entry.channel.replace(/^#/, "")}
                  </span>
                ) : (
                  <span className="inline-flex items-center text-xs font-mono px-2 py-0.5 rounded bg-discord-dark-400 text-discord-text-muted">
                    <Trans>network</Trans>
                  </span>
                )}
                <span className="text-[11px] text-discord-text-muted">
                  {formatRelative(entry.createdAt)}
                </span>
                {entry.redeemCount > 0 && (
                  <span
                    className="text-[11px] bg-green-900/30 text-green-300 px-1.5 py-0.5 rounded"
                    title={t`This many people registered through this link`}
                  >
                    {entry.redeemCount} <Trans>used</Trans>
                  </span>
                )}
              </div>
              {entry.description && (
                <div className="text-sm text-white/80 mb-1 break-words">
                  {entry.description}
                </div>
              )}
              <code className="text-xs text-discord-text-muted break-all font-mono">
                {entry.url}
              </code>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => handleCopy(entry.url, entry.shareId)}
                className="bg-discord-dark-400 hover:bg-discord-dark-100 text-white rounded px-3 py-1.5 text-xs inline-flex items-center gap-1.5"
                title={t`Copy link`}
              >
                {copiedId === entry.shareId ? (
                  <>
                    <FaCheck size={10} className="text-green-400" />
                    <Trans>Copied</Trans>
                  </>
                ) : (
                  <>
                    <FaCopy size={10} />
                    <Trans>Copy</Trans>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(entry.shareId)}
                className={`rounded px-3 py-1.5 text-xs inline-flex items-center gap-1.5 ${
                  pendingDelete === entry.shareId
                    ? "bg-red-600 hover:bg-red-700 text-white"
                    : "bg-discord-dark-400 hover:bg-red-900/40 text-discord-text-muted hover:text-red-300"
                }`}
                title={
                  pendingDelete === entry.shareId
                    ? t`Click again to confirm`
                    : t`Delete this invite`
                }
              >
                <FaTrash size={10} />
                {pendingDelete === entry.shareId ? (
                  <Trans>Confirm?</Trans>
                ) : (
                  <Trans>Delete</Trans>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default InvitationsPanel;
