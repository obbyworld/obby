import { describe, expect, test } from "vitest";
import { filterMembers } from "../../src/lib/filterMembers";
import type { User } from "../../src/types";

const user = (username: string, extra: Partial<User> = {}): User => ({
  id: username,
  username,
  isOnline: true,
  ...extra,
});

const members = [
  user("Syzop", { realname: "Bram Matthys" }),
  user("NullPointer"),
  user("PeGaSuS"),
  user("UnrealFeeds", { realname: "UnrealIRCd Annoucements Bot" }),
  user("alice", { displayName: "Alice Wonder" }),
  user("bob", {
    metadata: { "display-name": { value: "Robert Tables", visibility: "*" } },
  }),
];
const names = (users: User[]) => users.map((u) => u.username);

describe("filterMembers", () => {
  test("keeps everyone, in order, for an empty query", () => {
    expect(names(filterMembers(members, "  "))).toEqual(names(members));
  });

  test("matches a nick by its start, ignoring case", () => {
    expect(names(filterMembers(members, "syz"))).toEqual(["Syzop"]);
  });

  test("matches word starts inside a nick", () => {
    expect(names(filterMembers(members, "np"))).toEqual(["NullPointer"]);
  });

  test("matches the real name and the display name", () => {
    expect(names(filterMembers(members, "bram"))).toEqual(["Syzop"]);
    expect(names(filterMembers(members, "wonder"))).toEqual(["alice"]);
    expect(names(filterMembers(members, "rob"))).toEqual(["bob"]);
  });

  test("keeps the list order and drops everyone else", () => {
    expect(names(filterMembers(members, "un"))).toEqual(["UnrealFeeds"]);
    expect(filterMembers(members, "zzz")).toEqual([]);
  });
});
