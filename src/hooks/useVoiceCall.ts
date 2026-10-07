import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import ircClient from "../lib/ircClient";
import {
  acquireVoiceClient,
  attachLiveVoiceClient,
  getLiveVoiceCalls,
  type LiveVoiceCall,
  subscribeLiveVoiceCalls,
  type VoiceClient,
  type VoiceMember,
  type VoiceMode,
  type VoiceRole,
  type VoiceState,
} from "../lib/voice";
import type { VoiceErrorCode } from "../lib/voiceErrors";

const REACTION_LIFETIME_MS = 2400;

interface VoiceReaction {
  id: number;
  nick: string;
  emoji: string;
}

export interface UseVoiceCallResult {
  state: VoiceState;
  error: VoiceErrorCode | null;
  clearError: () => void;
  reactions: VoiceReaction[];
  client: VoiceClient | null;
  selfNick: string;
  members: VoiceMember[];
  self: VoiceMember | undefined;
  mode: VoiceMode;
  role: VoiceRole;
  streamers: string[];
  isStreamRoom: boolean;
  isStreamer: boolean;
  isHost: boolean;
  streamerMembers: VoiceMember[];
  viewerMembers: VoiceMember[];
}

/** The only way a component reaches a VoiceClient. Acquires the shared
 *  (serverId, channel) call on mount and detaches its view callbacks on
 *  unmount -- the call itself keeps running so a user can navigate away
 *  and back, or watch it float in the pop-out, without dropping. */
export function useVoiceCall(
  serverId: string,
  channel: string,
  { isAttachOnly = false }: { isAttachOnly?: boolean } = {},
): UseVoiceCallResult {
  const [state, setState] = useState<VoiceState>({ phase: "idle" });
  const [error, setError] = useState<VoiceErrorCode | null>(null);
  const [reactions, setReactions] = useState<VoiceReaction[]>([]);
  const [client, setClient] = useState<VoiceClient | null>(null);
  const reactionIdRef = useRef(0);

  const selfNick = useMemo(() => {
    const u = ircClient.getCurrentUser(serverId);
    return u?.username || "you";
  }, [serverId]);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    const getVoiceClient = isAttachOnly
      ? attachLiveVoiceClient
      : acquireVoiceClient;
    const attached = getVoiceClient({
      serverId,
      channel,
      selfNick,
      onState: setState,
      onError: setError,
      onReaction: (nick, emoji) => {
        const id = ++reactionIdRef.current;
        setReactions((rs) => [...rs, { id, nick, emoji }]);
        setTimeout(() => {
          setReactions((rs) => rs.filter((r) => r.id !== id));
        }, REACTION_LIFETIME_MS);
      },
    });
    if (!attached) return;
    setClient(attached.client);
    setState(attached.client.getState());
    return () => {
      attached.detach();
    };
  }, [serverId, channel, selfNick, isAttachOnly]);

  const members =
    state.phase === "connected" ? Object.values(state.members) : [];
  const mode = state.phase === "connected" ? state.mode : "voice";
  const role = state.phase === "connected" ? state.role : "streamer";
  const streamers = state.phase === "connected" ? state.streamers : [];
  const isStreamRoom = mode === "stream";
  const isStreamer = role === "streamer";
  const isHost = isStreamRoom && streamers[0] === selfNick;
  const streamerMembers = isStreamRoom
    ? members.filter((m) => streamers.includes(m.nick))
    : members;
  const viewerMembers = isStreamRoom
    ? members.filter((m) => !streamers.includes(m.nick))
    : [];
  const self = members.find((m) => m.nick === selfNick);

  return {
    state,
    error,
    clearError,
    reactions,
    client,
    selfNick,
    members,
    self,
    mode,
    role,
    streamers,
    isStreamRoom,
    isStreamer,
    isHost,
    streamerMembers,
    viewerMembers,
  };
}

/** Every live call across all channels, for the floating pop-out to pick
 *  whichever one the user isn't currently looking at. */
export function useLiveVoiceCalls(): LiveVoiceCall[] {
  return useSyncExternalStore(
    subscribeLiveVoiceCalls,
    getLiveVoiceCalls,
    getLiveVoiceCalls,
  );
}
