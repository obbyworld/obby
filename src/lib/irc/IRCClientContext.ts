import type { Server, User } from "../../types";
import type { EventMap } from "./IRCClient";

type EventKey = keyof EventMap;

export interface IRCClientContext {
  // Data maps accessed within handleMessage branches
  servers: Map<string, Server>;
  nicks: Map<string, string>;
  myIdents: Map<string, string>;
  myHosts: Map<string, string>;
  currentUsers: Map<string, User | null>;
  pongTimeouts: Map<string, NodeJS.Timeout>;
  reconnectionTimeouts: Map<string, NodeJS.Timeout>;
  rateLimitedServers: Map<string, number>;
  capNegotiationComplete: Map<string, boolean>;
  activeBatches: Map<
    string,
    Map<
      string,
      {
        type: string;
        parameters?: string[];
        messages: string[];
        concatFlags?: boolean[];
        sender?: string;
        messageIds?: string[];
        timestamps?: Date[];
        batchMsgId?: string;
        batchTime?: Date;
        batchTags?: Record<string, string>;
      }
    >
  >;

  // Public methods
  sendRaw(serverId: string, command: string): void;
  // CAP END that first emits a queued `BOUNCER BIND <netid>` if this
  // serverId was marked as a bouncer child. Centralised so the
  // bind-before-end invariant lives in one place.
  sendCapEnd(serverId: string): void;
  triggerEvent<K extends EventKey>(event: K, data: EventMap[K]): void;

  // Private methods exposed for handlers
  isRateLimitError(message: string): boolean;
  startWebSocketPing(serverId: string): void;
  userOnConnect(serverId: string): void;
  onCapLs(serverId: string, caps: string, isFinal: boolean): void;
  onCapAck(serverId: string, caps: string): void;
  onCapNew(serverId: string, caps: string): void;
  onCapDel(serverId: string, caps: string): void;
}
