// REST client for the hosted-backend's draft/custom-emoji admin
// endpoints (see /home/valerie/obbyircd/hosted-backend/emoji.go).
//
// Auth: every admin call runs as `Authorization: Bearer <token>` where
// the token comes from the draft/authtoken flow.  The backend's
// TokenAuthMiddleware validates the token via TOKEN VALIDATE on a
// long-lived IRC connection and gates admin endpoints on
// requireIRCOp=true (the user must be in OPER_CHANNEL).
//
// We reuse the "filehost" service token because the backend deploys
// both upload and emoji-admin under the same IRC_SERVICE -- a single
// token unlocks both.

import { waitForAuthToken } from "./authToken";
import ircClient from "./ircClient";

export interface AdminPack {
  pack_id: string;
  name: string;
  description: string;
  scope: "server" | "channel";
  channel_name?: string;
  updated_at: string;
  emoji_count: number;
}

export interface CreatePackBody {
  pack_id: string;
  name: string;
  description?: string;
  authors?: string[];
  homepage?: string;
  required?: string[];
  scope: "server" | "channel";
  channel_name?: string;
}

export interface AddEmojiBody {
  shortcode: string;
  url: string;
  alt?: string;
}

/**
 * Get a fresh bearer token via the draft/authtoken flow, waiting up to
 * 5 s for the TOKEN_GENERATE reply.  Throws when the server never
 * answers (the most common failure on a non-emoji-aware deployment).
 */
async function getAdminToken(serverId: string): Promise<string> {
  ircClient.requestToken(serverId, "filehost");
  const token = await waitForAuthToken(serverId, "filehost");
  if (!token) {
    throw new Error(
      "Could not obtain an auth token from the server.  Is draft/authtoken " +
        "configured?",
    );
  }
  return token;
}

function backendBase(authTokenUrl?: string, filehost?: string): string {
  const base = authTokenUrl || filehost;
  if (!base) {
    throw new Error(
      "No backend URL is configured for this server.  Configure draft/authtoken " +
        "or obby.world/FILEHOST.",
    );
  }
  return base.replace(/\/$/, "");
}

async function request<T>(
  url: string,
  init: RequestInit,
  serverId: string,
): Promise<T> {
  const token = await getAdminToken(serverId);
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export async function listPacks(
  serverId: string,
  base: string,
): Promise<AdminPack[]> {
  return request<AdminPack[]>(
    `${backendBase(base)}/emoji/admin/packs`,
    { method: "GET" },
    serverId,
  );
}

export async function createPack(
  serverId: string,
  base: string,
  body: CreatePackBody,
): Promise<{ pack_id: string }> {
  return request(
    `${backendBase(base)}/emoji/admin/packs`,
    { method: "POST", body: JSON.stringify(body) },
    serverId,
  );
}

export async function deletePack(
  serverId: string,
  base: string,
  packId: string,
): Promise<void> {
  return request(
    `${backendBase(base)}/emoji/admin/packs/${encodeURIComponent(packId)}`,
    { method: "DELETE" },
    serverId,
  );
}

export async function addEmoji(
  serverId: string,
  base: string,
  packId: string,
  body: AddEmojiBody,
): Promise<void> {
  return request(
    `${backendBase(base)}/emoji/admin/packs/${encodeURIComponent(packId)}/emoji`,
    { method: "POST", body: JSON.stringify(body) },
    serverId,
  );
}

export async function deleteEmoji(
  serverId: string,
  base: string,
  packId: string,
  shortcode: string,
): Promise<void> {
  return request(
    `${backendBase(base)}/emoji/admin/packs/${encodeURIComponent(
      packId,
    )}/emoji/${encodeURIComponent(shortcode)}`,
    { method: "DELETE" },
    serverId,
  );
}

/**
 * Fetch a pack's full content (including emojis) from the public
 * endpoint.  Used by the admin UI to populate the per-pack emoji list
 * since the admin list endpoint only returns counts.
 */
export async function fetchPackJson(url: string): Promise<
  Array<{
    id: string;
    name: string;
    emoji: Record<string, { url: string; alt?: string }>;
  }>
> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`pack fetch ${res.status}`);
  const body = await res.json();
  return Array.isArray(body) ? body : [body];
}
