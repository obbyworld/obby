export type SearchScope =
  | { kind: "chat"; serverId: string; target: string }
  | { kind: "network"; serverId: string }
  | { kind: "everywhere" };

export interface SearchQuery {
  text: string;
  scope: SearchScope;
  from?: string;
  aboutMe?: boolean;
  mentions?: string;
  hasLink?: boolean;
  before?: number;
  after?: number;
}

export interface SearchHit {
  serverId: string;
  target: string;
  time: number;
  nick: string;
  text: string;
  msgid?: string;
  isAboutMe: boolean;
  aboutMe?: "mention" | "reply";
}

export interface SearchPage {
  hits: SearchHit[];
  // Pass back as `beforeTime` and `skipAtBeforeTime` to read the next page.
  nextBeforeTime?: number;
  nextSkip?: number;
}
