import type { VoiceMember } from "../../lib/voice";

/** Picks the primary member to show in a floating pop-out or PiP window:
 *  a screen share first, then the shared spotlight (see voiceSpotlight.ts)
 *  if it names someone in the call, then the first member with a camera on,
 *  then whoever leads `ordered` (as produced by useSpeakingOrder), and only
 *  the local user if nobody else is in the call. `ordered` may already be scoped to a subset of the
 *  call (e.g. streamers only, excluding a local viewer), in which case
 *  the local-user fallback simply never fires. */
export function pickPipMember(
  ordered: VoiceMember[],
  selfNick: string,
  spotlightNick?: string | null,
): VoiceMember | undefined {
  const others = ordered.filter((m) => m.nick !== selfNick);
  const spotlighted = spotlightNick
    ? others.find((m) => m.nick === spotlightNick)
    : undefined;
  return (
    others.find((m) => m.screenSharing) ??
    spotlighted ??
    others.find((m) => m.videoTrack) ??
    others[0] ??
    ordered.find((m) => m.nick === selfNick)
  );
}
