// IRCop-only admin UI for managing draft/custom-emoji packs against
// the hosted-backend.  Lists packs, lets you create/delete a pack,
// add/delete individual emoji entries, and previews each emoji as
// the user uploads it.
//
// Auth: each request goes through emojiAdminApi which mints a fresh
// draft/authtoken bearer per call.  The backend gates admin endpoints
// on IRCop status (membership in OPER_CHANNEL).

import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { FaTimes } from "react-icons/fa";
import {
  type AdminPack,
  addEmoji,
  type CreatePackBody,
  createPack,
  deleteEmoji,
  deletePack,
  fetchPackJson,
  listPacks,
} from "../../lib/emojiAdminApi";
import useStore from "../../store";

interface Props {
  serverId: string;
  onClose: () => void;
}

interface ExpandedPackEmoji {
  shortcode: string;
  url: string;
  alt?: string;
}

export const EmojiPackAdminModal: React.FC<Props> = ({ serverId, onClose }) => {
  const server = useStore((s) => s.servers.find((srv) => srv.id === serverId));
  const baseUrl = server?.authTokenUrl || server?.filehost || "";

  const [packs, setPacks] = useState<AdminPack[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, ExpandedPackEmoji[]>>(
    {},
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setPacks(await listPacks(serverId, baseUrl));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [serverId, baseUrl]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ===== Create-pack form =====
  const [showCreate, setShowCreate] = useState(false);
  const [newPackId, setNewPackId] = useState("");
  const [newPackName, setNewPackName] = useState("");
  const [newPackDesc, setNewPackDesc] = useState("");
  const [newPackScope, setNewPackScope] = useState<"server" | "channel">(
    "server",
  );
  const [newPackChannel, setNewPackChannel] = useState("");
  const [creating, setCreating] = useState(false);

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!newPackId.trim() || !newPackName.trim()) {
      setErr("pack_id and name are required.");
      return;
    }
    if (newPackScope === "channel" && !newPackChannel.trim()) {
      setErr("Channel name required for channel-scoped packs.");
      return;
    }
    setCreating(true);
    try {
      const body: CreatePackBody = {
        pack_id: newPackId.trim(),
        name: newPackName.trim(),
        description: newPackDesc.trim(),
        scope: newPackScope,
        channel_name:
          newPackScope === "channel" ? newPackChannel.trim() : undefined,
      };
      await createPack(serverId, baseUrl, body);
      setShowCreate(false);
      setNewPackId("");
      setNewPackName("");
      setNewPackDesc("");
      setNewPackChannel("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const removePack = async (packId: string) => {
    if (
      !window.confirm(
        `Delete pack "${packId}"?  This also deletes every emoji in it.`,
      )
    ) {
      return;
    }
    setErr(null);
    try {
      await deletePack(serverId, baseUrl, packId);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  // ===== Per-pack emoji list (lazily fetched on expand) =====
  const togglePack = async (pack: AdminPack) => {
    if (expanded[pack.pack_id]) {
      const next = { ...expanded };
      delete next[pack.pack_id];
      setExpanded(next);
      return;
    }
    try {
      // The admin endpoint only gives counts; pull the public JSON to
      // see actual entries.
      const url =
        pack.scope === "channel" && pack.channel_name
          ? `${baseUrl.replace(/\/$/, "")}/emoji/channel/${encodeURIComponent(
              pack.channel_name,
            )}.json`
          : `${baseUrl.replace(/\/$/, "")}/emoji/pack.json`;
      const docs = await fetchPackJson(url);
      const ours = docs.find((d) => d.id === pack.pack_id);
      const list: ExpandedPackEmoji[] = ours
        ? Object.entries(ours.emoji).map(([shortcode, e]) => ({
            shortcode,
            url: e.url,
            alt: e.alt,
          }))
        : [];
      setExpanded({ ...expanded, [pack.pack_id]: list });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  // ===== Add-emoji form (per pack) =====
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newShortcode, setNewShortcode] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newAlt, setNewAlt] = useState("");

  const submitAddEmoji = async (e: React.FormEvent, packId: string) => {
    e.preventDefault();
    setErr(null);
    if (!/^[A-Za-z0-9._-]+$/.test(newShortcode.trim())) {
      setErr("Shortcode must match [A-Za-z0-9._-]+.");
      return;
    }
    if (!/^(https?:|data:)/.test(newUrl.trim())) {
      setErr("URL must be http(s):// or data:.");
      return;
    }
    try {
      await addEmoji(serverId, baseUrl, packId, {
        shortcode: newShortcode.trim(),
        url: newUrl.trim(),
        alt: newAlt.trim() || undefined,
      });
      setNewShortcode("");
      setNewUrl("");
      setNewAlt("");
      // Force re-expand to refresh
      const next = { ...expanded };
      delete next[packId];
      setExpanded(next);
      const pack = packs.find((p) => p.pack_id === packId);
      if (pack) await togglePack(pack);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const removeEmoji = async (packId: string, shortcode: string) => {
    setErr(null);
    try {
      await deleteEmoji(serverId, baseUrl, packId, shortcode);
      const pack = packs.find((p) => p.pack_id === packId);
      const next = { ...expanded };
      delete next[packId];
      setExpanded(next);
      if (pack) await togglePack(pack);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
      <div className="bg-discord-dark-200 rounded-lg w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-white">
            Custom emoji packs
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-discord-text-muted hover:text-white"
            aria-label="Close"
          >
            <FaTimes />
          </button>
        </div>

        {!baseUrl && (
          <p className="text-discord-yellow text-sm mb-4">
            This server doesn't advertise a backend URL (draft/authtoken or
            obby.world/FILEHOST). The admin endpoints can't be reached.
          </p>
        )}

        <div className="flex justify-end mb-3">
          <button
            type="button"
            onClick={() => setShowCreate(!showCreate)}
            className="px-3 py-1 rounded bg-discord-blue text-white text-sm font-medium"
          >
            {showCreate ? "Cancel" : "New pack"}
          </button>
        </div>

        {showCreate && (
          <form
            onSubmit={submitCreate}
            className="mb-4 p-3 rounded bg-discord-dark-300 space-y-2"
          >
            <input
              type="text"
              value={newPackId}
              onChange={(e) => setNewPackId(e.target.value)}
              placeholder="pack_id (e.g. team-mascots)"
              className="w-full px-3 py-2 rounded bg-discord-dark-400 text-white text-sm"
            />
            <input
              type="text"
              value={newPackName}
              onChange={(e) => setNewPackName(e.target.value)}
              placeholder="Display name"
              className="w-full px-3 py-2 rounded bg-discord-dark-400 text-white text-sm"
            />
            <input
              type="text"
              value={newPackDesc}
              onChange={(e) => setNewPackDesc(e.target.value)}
              placeholder="Description (optional)"
              className="w-full px-3 py-2 rounded bg-discord-dark-400 text-white text-sm"
            />
            <div className="flex gap-2">
              <select
                value={newPackScope}
                onChange={(e) =>
                  setNewPackScope(e.target.value as "server" | "channel")
                }
                className="flex-1 px-3 py-2 rounded bg-discord-dark-400 text-white text-sm"
              >
                <option value="server">Server-wide</option>
                <option value="channel">Channel-scoped</option>
              </select>
              {newPackScope === "channel" && (
                <input
                  type="text"
                  value={newPackChannel}
                  onChange={(e) => setNewPackChannel(e.target.value)}
                  placeholder="#channel"
                  className="flex-1 px-3 py-2 rounded bg-discord-dark-400 text-white text-sm"
                />
              )}
            </div>
            <button
              type="submit"
              disabled={creating}
              className="w-full px-3 py-2 rounded bg-discord-green text-white text-sm font-medium disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create pack"}
            </button>
          </form>
        )}

        {loading && <p className="text-sm text-discord-text-muted">Loading…</p>}

        {!loading && packs.length === 0 && (
          <p className="text-sm text-discord-text-muted">
            No packs configured yet.
          </p>
        )}

        <div className="space-y-2">
          {packs.map((pack) => {
            const open = !!expanded[pack.pack_id];
            const entries = expanded[pack.pack_id] ?? [];
            return (
              <div
                key={pack.pack_id}
                className="rounded bg-discord-dark-300 p-3"
              >
                <div className="flex justify-between items-start">
                  <button
                    type="button"
                    onClick={() => togglePack(pack)}
                    className="text-left flex-1"
                  >
                    <div className="text-white font-medium">{pack.name}</div>
                    <div className="text-xs text-discord-text-muted">
                      {pack.pack_id} · {pack.scope}
                      {pack.scope === "channel" && pack.channel_name
                        ? ` (${pack.channel_name})`
                        : ""}{" "}
                      · {pack.emoji_count} emoji
                    </div>
                    {pack.description && (
                      <div className="text-xs text-discord-text-muted italic mt-1">
                        {pack.description}
                      </div>
                    )}
                  </button>
                  <div className="flex gap-2 ml-2">
                    <button
                      type="button"
                      onClick={() =>
                        setAddingTo(
                          addingTo === pack.pack_id ? null : pack.pack_id,
                        )
                      }
                      className="text-xs px-2 py-1 rounded bg-discord-dark-100 text-white"
                    >
                      Add emoji
                    </button>
                    <button
                      type="button"
                      onClick={() => removePack(pack.pack_id)}
                      className="text-xs px-2 py-1 rounded text-discord-red hover:bg-discord-dark-100"
                    >
                      Delete pack
                    </button>
                  </div>
                </div>

                {addingTo === pack.pack_id && (
                  <form
                    onSubmit={(e) => submitAddEmoji(e, pack.pack_id)}
                    className="mt-3 p-2 rounded bg-discord-dark-400 space-y-2"
                  >
                    <input
                      type="text"
                      value={newShortcode}
                      onChange={(e) => setNewShortcode(e.target.value)}
                      placeholder="shortcode (e.g. partyparrot)"
                      className="w-full px-2 py-1 rounded bg-discord-dark-300 text-white text-sm"
                    />
                    <input
                      type="url"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      placeholder="https://example.com/parrot.gif"
                      className="w-full px-2 py-1 rounded bg-discord-dark-300 text-white text-sm"
                    />
                    <input
                      type="text"
                      value={newAlt}
                      onChange={(e) => setNewAlt(e.target.value)}
                      placeholder="Alt text (optional)"
                      className="w-full px-2 py-1 rounded bg-discord-dark-300 text-white text-sm"
                    />
                    <button
                      type="submit"
                      className="w-full px-2 py-1 rounded bg-discord-green text-white text-sm font-medium"
                    >
                      Add emoji
                    </button>
                  </form>
                )}

                {open && entries.length > 0 && (
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {entries.map((entry) => (
                      <div
                        key={entry.shortcode}
                        className="flex items-center gap-2 p-2 rounded bg-discord-dark-400"
                      >
                        <img
                          src={entry.url}
                          alt={entry.alt ?? entry.shortcode}
                          className="w-6 h-6 object-contain flex-shrink-0"
                          loading="lazy"
                        />
                        <span className="text-xs text-white truncate flex-1">
                          :{entry.shortcode}:
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            removeEmoji(pack.pack_id, entry.shortcode)
                          }
                          className="text-xs text-discord-red hover:text-white"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {open && entries.length === 0 && (
                  <p className="mt-2 text-xs text-discord-text-muted">
                    Empty pack — add some emoji.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {err && <p className="text-discord-red text-xs mt-3">{err}</p>}
      </div>
    </div>
  );
};

export default EmojiPackAdminModal;
