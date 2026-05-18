import type { StoreApi } from "zustand";
import type { AppState } from "../index";
import { registerAuthHandlers } from "./auth";
import { registerBatchHandlers } from "./batches";
import { registerChannelHandlers } from "./channels";
import { registerConnectionHandlers } from "./connection";
import { registerInvitelinkHandlers } from "./invitelink";
import { registerMessageHandlers } from "./messages";
import { registerMetadataHandlers } from "./metadata";
import { registerNamedModesHandlers } from "./named-modes";
import { registerReadMarkerHandlers } from "./readMarker";
import { registerTicTacToeHandlers } from "./tictactoe";
import { registerUserHandlers } from "./users";
import { registerWhoisHandlers } from "./whois";

export function registerAllHandlers(store: StoreApi<AppState>): void {
  registerConnectionHandlers(store);
  registerMessageHandlers(store);
  registerUserHandlers(store);
  registerChannelHandlers(store);
  registerWhoisHandlers(store);
  registerMetadataHandlers(store);
  registerInvitelinkHandlers(store);
  registerBatchHandlers(store);
  registerAuthHandlers(store);
  registerNamedModesHandlers(store);
  registerReadMarkerHandlers(store);
  registerTicTacToeHandlers(store);
}
