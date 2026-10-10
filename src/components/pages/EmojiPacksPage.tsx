// The backend gates these admin endpoints on IRCop status, so a non-operator gets an error back from them.

import { Trans, useLingui } from "@lingui/react/macro";
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
import { Button } from "../../lib/modal/components";
import useStore from "../../store";
import { PageShell } from "../ui/page/PageShell";
import { SettingGroup, SettingRow } from "../ui/page/SettingRow";
import type { PageProps } from "./PageHost";

interface ExpandedPackEmoji {
  shortcode: string;
  url: string;
  alt?: string;
}

const EmojiPacksPage: React.FC<PageProps<"emojiPacks">> = ({ page }) => {
  const { serverId } = page;
  const { t } = useLingui();
  const openPage = useStore((s) => s.openPage);
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
      setErr(t`pack_id and name are required.`);
      return;
    }
    if (newPackScope === "channel" && !newPackChannel.trim()) {
      setErr(t`Enter a channel name for channel-scoped packs.`);
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
        t`Delete pack "${packId}"? This also deletes every emoji in it.`,
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

  const togglePack = async (pack: AdminPack) => {
    if (expanded[pack.pack_id]) {
      const next = { ...expanded };
      delete next[pack.pack_id];
      setExpanded(next);
      return;
    }
    try {
      // The admin endpoint only returns counts, so we read the public JSON for the entries.
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

  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newShortcode, setNewShortcode] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newAlt, setNewAlt] = useState("");

  const submitAddEmoji = async (e: React.FormEvent, packId: string) => {
    e.preventDefault();
    setErr(null);
    if (!/^[A-Za-z0-9._-]+$/.test(newShortcode.trim())) {
      setErr(t`Shortcode must match [A-Za-z0-9._-]+.`);
      return;
    }
    if (!/^(https?:|data:)/.test(newUrl.trim())) {
      setErr(t`URL must be http(s):// or data:.`);
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
      // We drop the cached entries so togglePack fetches them again.
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

  const packEmoji = (pack: AdminPack) => {
    const open = !!expanded[pack.pack_id];
    const entries = expanded[pack.pack_id] ?? [];
    return (
      <>
        {addingTo === pack.pack_id && (
          <form
            onSubmit={(e) => submitAddEmoji(e, pack.pack_id)}
            className="flex flex-col gap-2"
          >
            <input
              type="text"
              value={newShortcode}
              onChange={(e) => setNewShortcode(e.target.value)}
              placeholder={t`shortcode (e.g. partyparrot)`}
              className="field-input"
            />
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://example.com/parrot.gif"
              className="field-input"
            />
            <input
              type="text"
              value={newAlt}
              onChange={(e) => setNewAlt(e.target.value)}
              placeholder={t`Alt text (optional)`}
              className="field-input"
            />
            <Button type="submit" variant="success">
              <Trans>Add emoji</Trans>
            </Button>
          </form>
        )}
        {open && entries.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {entries.map((entry) => (
              <div
                key={entry.shortcode}
                className="flex items-center gap-2 p-2 rounded-lg bg-discord-dark-400"
              >
                <img
                  src={entry.url}
                  alt={entry.alt ?? entry.shortcode}
                  className="w-6 h-6 object-contain shrink-0"
                  loading="lazy"
                />
                <span className="text-xs text-white truncate flex-1">
                  :{entry.shortcode}:
                </span>
                <button
                  type="button"
                  onClick={() => removeEmoji(pack.pack_id, entry.shortcode)}
                  className="icon-button w-6 h-6 rounded-md"
                  aria-label={t`Remove`}
                  title={t`Remove`}
                >
                  <FaTimes className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {open && entries.length === 0 && (
          <p className="text-xs text-discord-text-muted">
            <Trans>This pack has no emoji yet. Add one above.</Trans>
          </p>
        )}
      </>
    );
  };

  return (
    <PageShell
      title={t`Custom emoji packs`}
      wide
      back={{
        label: t`Back to Settings`,
        onBack: () => openPage({ kind: "settings", section: "account" }),
      }}
      headerActions={
        <Button
          variant={showCreate ? "secondary" : "primary"}
          onClick={() => setShowCreate(!showCreate)}
        >
          {showCreate ? t`Cancel` : t`Create pack`}
        </Button>
      }
    >
      {!baseUrl && (
        <p className="text-discord-yellow text-sm">
          <Trans>
            Ask the server admin to advertise a backend URL (draft/authtoken or
            obby.world/FILEHOST) to manage packs.
          </Trans>
        </p>
      )}

      {showCreate && (
        <SettingGroup title={<Trans>New pack</Trans>}>
          <form
            onSubmit={submitCreate}
            className="px-4 py-3.5 flex flex-col gap-2"
          >
            <input
              type="text"
              value={newPackId}
              onChange={(e) => setNewPackId(e.target.value)}
              placeholder={t`pack_id (e.g. team-mascots)`}
              className="field-input"
            />
            <input
              type="text"
              value={newPackName}
              onChange={(e) => setNewPackName(e.target.value)}
              placeholder={t`Display Name`}
              className="field-input"
            />
            <input
              type="text"
              value={newPackDesc}
              onChange={(e) => setNewPackDesc(e.target.value)}
              placeholder={t`Description (optional)`}
              className="field-input"
            />
            <div className="flex gap-2">
              <select
                value={newPackScope}
                onChange={(e) =>
                  setNewPackScope(e.target.value as "server" | "channel")
                }
                className="field-input"
              >
                <option value="server">
                  <Trans>Server-wide</Trans>
                </option>
                <option value="channel">
                  <Trans>Channel-scoped</Trans>
                </option>
              </select>
              {newPackScope === "channel" && (
                <input
                  type="text"
                  value={newPackChannel}
                  onChange={(e) => setNewPackChannel(e.target.value)}
                  placeholder="#channel"
                  className="field-input"
                />
              )}
            </div>
            <Button type="submit" variant="success" disabled={creating}>
              {creating ? t`Creating…` : t`Create pack`}
            </Button>
          </form>
        </SettingGroup>
      )}

      <SettingGroup title={<Trans>Packs</Trans>}>
        {packs.length === 0 && (
          <SettingRow
            title={
              <span className="text-discord-text-muted">
                {loading ? (
                  <Trans>Loading…</Trans>
                ) : (
                  <Trans>No packs yet. Create one to start.</Trans>
                )}
              </span>
            }
          />
        )}
        {packs.map((pack) => (
          <SettingRow
            key={pack.pack_id}
            title={
              <button
                type="button"
                onClick={() => togglePack(pack)}
                className="text-left"
              >
                {pack.name}
              </button>
            }
            description={
              <>
                {pack.pack_id} · {pack.scope}
                {pack.scope === "channel" && pack.channel_name
                  ? ` (${pack.channel_name})`
                  : ""}{" "}
                · <Trans>{pack.emoji_count} emoji</Trans>
                {pack.description && (
                  <span className="block italic">{pack.description}</span>
                )}
              </>
            }
            control={
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    setAddingTo(addingTo === pack.pack_id ? null : pack.pack_id)
                  }
                >
                  <Trans>Add emoji</Trans>
                </Button>
                <Button
                  variant="danger"
                  onClick={() => removePack(pack.pack_id)}
                >
                  <Trans>Delete pack</Trans>
                </Button>
              </div>
            }
          >
            {packEmoji(pack)}
          </SettingRow>
        ))}
      </SettingGroup>

      {err && <p className="text-discord-red text-xs">{err}</p>}
    </PageShell>
  );
};

export default EmojiPacksPage;
