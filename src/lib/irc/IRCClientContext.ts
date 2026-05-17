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
  /** Per-server accumulated ISUPPORT values.  Needed for the v0.2
   *  `KEY+=value` append form: each chunk arrives as its own
   *  RPL_ISUPPORT line, so the parser must remember the running
   *  concatenation across calls and emit the cumulative total to
   *  downstream consumers. */
  isupportValues: Map<string, Map<string, string>>;
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
