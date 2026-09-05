import type { VoiceMember } from "../../lib/voice";

/** Picks the primary member to show in a floating pop-out or PiP window:
 *  a screen share first, then the shared spotlight (see voiceSpotlight.ts)
 *  if it names someone in the call, then whoever leads `ordered` (as
 *  produced by useSpeakingOrder), and only the local user if nobody else
 *  is in the call. */
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
    others[0] ??
    ordered.find((m) => m.nick === selfNick)
  );
}
