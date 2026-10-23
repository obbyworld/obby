import { useMemo, useRef } from "react";
import type { VoiceMember } from "../lib/voice";

function isSpeaking(m: VoiceMember): boolean {
  return m.speaking && m.micOn;
}

/** Ranks call members by conversational relevance so the stage and the
 *  pop-out both agree on who matters right now: active speakers first
 *  (longest-uninterrupted one leading), then everyone else by how
 *  recently they last spoke, then anyone who has never spoken in their
 *  original join order. Returns the same array reference across
 *  renders where nobody's speaking state actually changed. */
export function useSpeakingOrder(members: VoiceMember[]): VoiceMember[] {
  const speakingSinceRef = useRef(new Map<string, number>());
  const lastSpokeAtRef = useRef(new Map<string, number>());
  const wasSpeakingRef = useRef(new Map<string, boolean>());
  const joinOrderRef = useRef(new Map<string, number>());
  const nextJoinIndexRef = useRef(0);
  const cacheRef = useRef<{ signature: string; order: VoiceMember[] }>({
    signature: "",
    order: [],
  });

  const signature = members
    .map((m) => `${m.nick}:${isSpeaking(m) ? 1 : 0}`)
    .join("|");

  return useMemo(() => {
    if (signature === cacheRef.current.signature) {
      return cacheRef.current.order;
    }

    // Detected and recorded synchronously (not in an effect) so a flip
    // is visible to this same render's sort instead of lagging one
    // commit behind, which would rank the just-flipped member wrong
    // until some unrelated later flip forced a recompute.
    const now = Date.now();
    const present = new Set<string>();
    for (const m of members) {
      present.add(m.nick);
      if (!joinOrderRef.current.has(m.nick)) {
        joinOrderRef.current.set(m.nick, nextJoinIndexRef.current++);
      }
      const nowSpeaking = isSpeaking(m);
      const wasSpeaking = wasSpeakingRef.current.get(m.nick) ?? false;
      if (nowSpeaking && !wasSpeaking) {
        speakingSinceRef.current.set(m.nick, now);
      } else if (!nowSpeaking && wasSpeaking) {
        speakingSinceRef.current.delete(m.nick);
        lastSpokeAtRef.current.set(m.nick, now);
      }
      wasSpeakingRef.current.set(m.nick, nowSpeaking);
    }
    for (const nick of Array.from(wasSpeakingRef.current.keys())) {
      if (!present.has(nick)) {
        wasSpeakingRef.current.delete(nick);
        speakingSinceRef.current.delete(nick);
        lastSpokeAtRef.current.delete(nick);
        joinOrderRef.current.delete(nick);
      }
    }

    const order = [...members].sort((a, b) => {
      const aSpeaking = isSpeaking(a);
      const bSpeaking = isSpeaking(b);
      if (aSpeaking !== bSpeaking) return aSpeaking ? -1 : 1;
      if (aSpeaking) {
        const aSince = speakingSinceRef.current.get(a.nick) ?? now;
        const bSince = speakingSinceRef.current.get(b.nick) ?? now;
        return aSince - bSince;
      }
      const aLast = lastSpokeAtRef.current.get(a.nick);
      const bLast = lastSpokeAtRef.current.get(b.nick);
      if (aLast !== undefined && bLast !== undefined) return bLast - aLast;
      if (aLast !== undefined) return -1;
      if (bLast !== undefined) return 1;
      const aOrder = joinOrderRef.current.get(a.nick) ?? 0;
      const bOrder = joinOrderRef.current.get(b.nick) ?? 0;
      return aOrder - bOrder;
    });

    cacheRef.current = { signature, order };
    return order;
  }, [signature, members]);
}

export default useSpeakingOrder;
