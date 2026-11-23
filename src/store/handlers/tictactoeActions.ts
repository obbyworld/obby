// Store-side actions for tic-tac-toe.  These both mutate the Zustand store
// and send TAGMSG packets via ircClient.  Imported from store/index.ts.

import {
  applyMove,
  type GameSnapshot,
  isLocalTurn,
  makeGame,
  pickStartPlayer,
  TTT_TAG,
  type TttMessage,
} from "../../lib/games/tictactoe";
import ircClient from "../../lib/ircClient";
import { formatTags } from "../../lib/ircUtils";
import type { AppState } from "../index";

type SetFn = (
  partial: Partial<AppState> | ((state: AppState) => Partial<AppState>),
) => void;
type GetFn = () => AppState;

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

function setGame(
  set: SetFn,
  serverId: string,
  opponent: string,
  g: GameSnapshot,
) {
  set((state) => ({
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

function deleteGame(set: SetFn, serverId: string, opponent: string) {
  set((state) => {
    const games = { ...state.tictactoe.games };
    if (games[serverId]) {
      const inner = { ...games[serverId] };
      delete inner[key(opponent)];
      games[serverId] = inner;
    }
    const open =
      state.tictactoe.open &&
      state.tictactoe.open.serverId === serverId &&
      key(state.tictactoe.open.opponent) === key(opponent)
        ? null
        : state.tictactoe.open;
    return { tictactoe: { ...state.tictactoe, games, open } };
  });
}

function sendTtt(serverId: string, target: string, msg: TttMessage) {
  const tags = formatTags({ [TTT_TAG]: JSON.stringify(msg) });
  ircClient.sendRaw(serverId, `${tags}TAGMSG ${target}`);
}

function localNick(serverId: string): string | undefined {
  return ircClient.getNick(serverId);
}

export function invite(
  set: SetFn,
  get: GetFn,
  serverId: string,
  opponent: string,
) {
  const me = localNick(serverId);
  if (!me) return;
  const existing = getGame(get(), serverId, opponent);
  const g = existing ?? makeGame(serverId, me, opponent);
  g.invitePending = true;
  g.inviteIncoming = false;
  g.terminated = false;
  g.statusMessage = `Invite sent to ${opponent}`;
  setGame(set, serverId, opponent, { ...g });
  sendTtt(serverId, opponent, { cmd: "invite" });
  set((state) => ({
    tictactoe: { ...state.tictactoe, open: { serverId, opponent } },
  }));
}

export function accept(
  set: SetFn,
  get: GetFn,
  serverId: string,
  opponent: string,
) {
  const me = localNick(serverId);
  if (!me) return;
  const g =
    getGame(get(), serverId, opponent) ?? makeGame(serverId, me, opponent);
  const startPlayer = pickStartPlayer(me, opponent);
  g.startPlayer = startPlayer;
  g.active = true;
  g.gameOver = false;
  g.winner = null;
  g.winLine = null;
  g.turn = 1;
  g.board = [
    ["", "", ""],
    ["", "", ""],
    ["", "", ""],
  ];
  g.inviteIncoming = false;
  g.invitePending = false;
  g.terminated = false;
  g.statusMessage = isLocalTurn(g) ? "Your turn!" : `Waiting for ${opponent}…`;
  setGame(set, serverId, opponent, { ...g });
  sendTtt(serverId, opponent, { cmd: "invite_accepted", startPlayer });
  set((state) => ({
    tictactoe: { ...state.tictactoe, open: { serverId, opponent } },
  }));
}

export function decline(
  set: SetFn,
  _get: GetFn,
  serverId: string,
  opponent: string,
) {
  sendTtt(serverId, opponent, { cmd: "invite_declined" });
  deleteGame(set, serverId, opponent);
}

export function move(
  set: SetFn,
  get: GetFn,
  serverId: string,
  opponent: string,
  row: number,
  col: number,
) {
  const g = getGame(get(), serverId, opponent);
  if (!g?.active || g.gameOver) return;
  if (!isLocalTurn(g)) return;
  const turnAtSend = g.turn;
  const next: GameSnapshot = {
    ...g,
    board: g.board.map((r) => [...r]),
  };
  if (!applyMove(next, row, col)) return;
  if (!next.gameOver) {
    next.statusMessage = `Waiting for ${opponent}…`;
  } else if (next.winner === "draw") {
    next.statusMessage = "Draw!";
  } else {
    next.statusMessage = isLocalTurn({
      ...next,
      turn: turnAtSend,
      gameOver: false,
    })
      ? `You win! (${next.winner})`
      : `${opponent} wins! (${next.winner})`;
  }
  setGame(set, serverId, opponent, next);
  sendTtt(serverId, opponent, {
    cmd: "action",
    clicked: [row, col],
    turn: turnAtSend,
  });
}

export function terminate(
  set: SetFn,
  get: GetFn,
  serverId: string,
  opponent: string,
) {
  const g = getGame(get(), serverId, opponent);
  if (!g) return;
  if (g.inviteIncoming) {
    sendTtt(serverId, opponent, { cmd: "invite_declined" });
    deleteGame(set, serverId, opponent);
    return;
  }
  if (g.active && !g.gameOver) {
    sendTtt(serverId, opponent, { cmd: "terminate" });
  }
  deleteGame(set, serverId, opponent);
}
