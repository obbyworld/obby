import useStore from "../store";

// A peer picks this value and we put it straight into a style attribute, so
// only shapes CSS can parse as a colour get through.
const COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([0-9.,%\s/-]+\)|[a-z]{3,20})$/i;

export function isDisplayColor(value: string | undefined): value is string {
  return !!value && COLOR.test(value.trim());
}

/** The colour a user chose for their name, or undefined when they have not
 *  set one. Metadata belongs to the user rather than to one channel, so the
 *  first channel that carries it answers for all of them. */
export function useUserColor(
  serverId: string | undefined,
  nick: string | undefined,
): string | undefined {
  return useStore((s) => {
    if (!serverId || !nick) return undefined;
    const server = s.servers.find((x) => x.id === serverId);
    if (!server) return undefined;
    const lc = nick.toLowerCase();
    for (const channel of server.channels) {
      const value = channel.users.find((u) => u.username.toLowerCase() === lc)
        ?.metadata?.color?.value;
      if (isDisplayColor(value)) return value;
    }
    return undefined;
  });
}
