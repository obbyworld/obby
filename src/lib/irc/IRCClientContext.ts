import type { Server, User, WhoisSession } from "../../types";
import type { EventMap } from "./IRCClient";

type EventKey = keyof EventMap;

/**
 * State accumulated while an obby.world/whois parent batch is open
 * and its obby.world/whois-session sub-batches stream in.
 * Indexed by serverId -> parent-batch-ref.
 */
export interface WhoisBuilder {
  /** Target nick the parent BATCH+ line was opened for */
  target: string;
  /**
   * Sessions in arrival order. Each entry begins life when its
   * sub-batch opens; per-session numerics populate the fields.
   * Indexed by sub-batch ref so per-numeric routing can find it.
   */
  sessionsByRef: Map<string, WhoisSession>;
  /**
   * Server-emitted "is connected from N sessions" privacy-summary
   * line, parsed from the 320 inside the parent batch when no
   * sub-batches are present.
   */
  summaryCount?: number;
  /**
   * Security-groups the target is in, in arrival order, populated
   * from the obby.world/whois-security-groups sub-batch.
   */
  securityGroups: string[];
}

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
  /**
   * In-flight obby.world/whois parent batches. Sub-batch numerics
   * accumulate into the matching builder's sessionsByRef; on parent
   * BATCH close the builder is flushed to a single event.
   * Indexed by serverId -> parent batch ref.
   */
  whoisBuilders: Map<string, Map<string, WhoisBuilder>>;

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
