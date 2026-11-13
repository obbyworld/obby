import type { User } from "../types";
import { fuzzyMatch } from "./fuzzySearch";

/** The members whose nick, display name or real name matches the query, in their original order. */
export function filterMembers(users: readonly User[], query: string): User[] {
  if (!query.trim()) return [...users];
  return users.filter((user) =>
    [
      user.username,
      user.metadata?.["display-name"]?.value,
      user.displayName,
      user.realname,
    ].some((name) => !!name && fuzzyMatch(query, name).matches),
  );
}

export default filterMembers;
