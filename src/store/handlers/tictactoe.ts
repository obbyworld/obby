// TAGMSG receiver for tic-tac-toe games.  Listens on the existing TAGMSG
// event the IRC layer fires and reacts to messages tagged with
// `+kiwiirc.com/ttt`.

import type { StoreApi } from "zustand";
import {
  applyMove,
  type GameSnapshot,
  isLocalTurn,
  makeGame,
  TTT_TAG,
  type TttMessage,
} from "../../lib/games/tictactoe";
import { unescapeTagValue } from "../../lib/games/tictactoeProtocol";
import ircClient from "../../lib/ircClient";
import type { AppState } from "../index";
import * as actions from "./tictactoeActions";

function key(opponent: string): string {
  return opponent.toLowerCase();
}

function getGame(
  state: AppState,
  serverId: string,
  opponent: string,
): GameSnapshot | undefined {
  return state.tictactoe.games[serverId]?.[key(opponent)];
}

function putGame(
  store: StoreApi<AppState>,
  serverId: string,
  opponent: string,
  g: GameSnapshot,
) {
  store.setState((state) => ({
    tictactoe: {
      ...state.tictactoe,
      games: {
        ...state.tictactoe.games,
        [serverId]: {
          ...(state.tictactoe.games[serverId] ?? {}),
          [key(opponent)]: g,
        },
      },
    },
  }));
}

export function registerTicTacToeHandlers(store: StoreApi<AppState>) {
  ircClient.on("TAGMSG", ({ serverId, mtags, sender, channelName }) => {
    const me = ircClient.getNick(serverId);
    if (!me || !mtags) return;
    // Only direct messages from another nick to us.
    if (channelName !== me) return;
    if (!sender || sender === me) return;

    const raw = mtags[TTT_TAG];
    if (!raw) return;
    const value = unescapeTagValue(raw);
    if (value?.[0] !== "{") return;

    let data: TttMessage | null = null;
    try {
      data = JSON.parse(value) as TttMessage;
    } catch {
      return;
    }
    if (!data || typeof data !== "object" || !("cmd" in data)) return;

    const opponent = sender;
    const state = store.getState();
    let game = getGame(state, serverId, opponent);

    switch (data.cmd) {
      case "invite": {
        if (!game) {
          game = makeGame(serverId, me, opponent);
        }
        game = {
          ...game,
          inviteIncoming: true,
          invitePending: false,
          statusMessage: `${opponent} invited you to play.`,
        };
        putGame(store, serverId, opponent, game);
        store.setState((state) => ({
          tictactoe: {
            ...state.tictactoe,
            open: state.tictactoe.open ?? { serverId, opponent },
          },
        }));
        // Acknowledge.
        ircClient.sendRaw(
          serverId,
          `@${TTT_TAG}={"cmd"\\:"invite_received"} TAGMSG ${opponent}`,
        );
        break;
      }
      case "invite_received": {
        // Inviter side: the other side has UI for the invite now -- we
        // don't need to do anything but stop any "still waiting" timer
        // (we don't have one).  Update status for clarity.
        if (game) {
          game = {
            ...game,
            statusMessage: `${opponent} sees the invite…`,
          };
          putGame(store, serverId, opponent, game);
        }
        break;
      }
      case "invite_accepted": {
        if (!game) return;
        const startPlayer = data.startPlayer;
        const next: GameSnapshot = {
          ...game,
          startPlayer,
          active: true,
          gameOver: false,
          winner: null,
          winLine: null,
          turn: 1,
          board: [
            ["", "", ""],
            ["", "", ""],
            ["", "", ""],
          ],
          invitePending: false,
          inviteIncoming: false,
          terminated: false,
          statusMessage: "",
        };
        next.statusMessage = isLocalTurn(next)
          ? "Your turn!"
          : `Waiting for ${opponent}…`;
        putGame(store, serverId, opponent, next);
        // Auto-open the modal so the inviter sees the game.
        store.setState((state) => ({
          tictactoe: {
            ...state.tictactoe,
            open: { serverId, opponent },
          },
        }));
        break;
      }
      case "invite_declined": {
        if (!game) return;
        actions.terminate(store.setState, store.getState, serverId, opponent);
        break;
      }
      case "action": {
        if (!game?.active || game.gameOver) return;
        const [row, col] = data.clicked ?? [-1, -1];
        // The remote turn number is the turn they had BEFORE making the
        // move; if it doesn't match our current turn we've gone out of
        // sync and the safe thing to do is end the game.
        if (data.turn !== game.turn) {
          const broken: GameSnapshot = {
            ...game,
            gameOver: true,
            statusMessage: "Out of sync — game ended.",
          };
          putGame(store, serverId, opponent, broken);
          ircClient.sendRaw(
            serverId,
            `@${TTT_TAG}={"cmd"\\:"error"\\,"message"\\:"out of sync"} TAGMSG ${opponent}`,
          );
          return;
        }
        const next: GameSnapshot = {
          ...game,
          board: game.board.map((r) => [...r]),
        };
        if (!applyMove(next, row, col)) {
          return;
        }
        if (!next.gameOver) {
          next.statusMessage = isLocalTurn(next)
            ? "Your turn!"
            : `Waiting for ${opponent}…`;
        } else if (next.winner === "draw") {
          next.statusMessage = "Draw!";
        } else {
          next.statusMessage = `${opponent} wins! (${next.winner})`;
        }
        putGame(store, serverId, opponent, next);
        break;
      }
      case "error": {
        if (!game) return;
        putGame(store, serverId, opponent, {
          ...game,
          gameOver: true,
          statusMessage:
            "message" in data
              ? `Error from ${opponent}: ${data.message}`
              : `Error from ${opponent}`,
        });
        break;
      }
      case "terminate": {
        if (!game) return;
        putGame(store, serverId, opponent, {
          ...game,
          gameOver: true,
          terminated: true,
          statusMessage: `${opponent} ended the game.`,
        });
        break;
      }
    }
  });
}
