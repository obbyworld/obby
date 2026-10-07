import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useMemo } from "react";
import { isLocalTurn, isWinningCell } from "../../lib/games/tictactoe";
import useStore from "../../store";

export const TicTacToeModal: React.FC = () => {
  const { t } = useLingui();
  const open = useStore((s) => s.tictactoe?.open ?? null);
  const games = useStore((s) => s.tictactoe?.games ?? {});
  const accept = useStore((s) => s.tictactoeAccept);
  const decline = useStore((s) => s.tictactoeDecline);
  const move = useStore((s) => s.tictactoeMove);
  const terminate = useStore((s) => s.tictactoeTerminate);
  const closeModal = useStore((s) => s.tictactoeCloseModal);

  const game = useMemo(() => {
    if (!open) return null;
    return games[open.serverId]?.[open.opponent.toLowerCase()] ?? null;
  }, [open, games]);

  if (!open || !game) return null;

  const myTurn = game.active && !game.gameOver && isLocalTurn(game);
  const onClose = () => {
    terminate(open.serverId, open.opponent);
    closeModal();
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-discord-dark-200 rounded-lg w-full max-w-sm p-5">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-white">
            <Trans>Tic-Tac-Toe vs {open.opponent}</Trans>
          </h2>
          <button
            type="button"
            onClick={() => closeModal()}
            className="text-discord-text-muted hover:text-white"
            aria-label={t`Close`}
          >
            ✕
          </button>
        </div>

        {game.inviteIncoming && (
          <div className="mb-4 p-3 rounded bg-discord-dark-300">
            <p className="text-sm text-white mb-3">
              <Trans>{open.opponent} has invited you to play.</Trans>
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => decline(open.serverId, open.opponent)}
                className="px-3 py-2 rounded bg-discord-dark-100 text-white text-sm"
              >
                <Trans>Decline</Trans>
              </button>
              <button
                type="button"
                onClick={() => accept(open.serverId, open.opponent)}
                className="px-3 py-2 rounded bg-discord-green text-white text-sm"
              >
                <Trans>Accept</Trans>
              </button>
            </div>
          </div>
        )}

        {game.invitePending && !game.active && (
          <div className="mb-4 p-3 rounded bg-discord-dark-300 text-sm text-white">
            <Trans>Waiting for {open.opponent} to accept…</Trans>
          </div>
        )}

        {(game.active || game.gameOver) && (
          <div className="mb-3">
            <table className="mx-auto border-collapse">
              <tbody>
                {game.board.map((row, r) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 3x3 fixed grid
                  <tr key={r}>
                    {row.map((cell, c) => {
                      const playable = myTurn && cell === "" && !game.gameOver;
                      const win = isWinningCell(game, r, c);
                      return (
                        <td
                          // biome-ignore lint/suspicious/noArrayIndexKey: 3x3 fixed grid
                          key={c}
                          onClick={
                            playable
                              ? () => move(open.serverId, open.opponent, r, c)
                              : undefined
                          }
                          onKeyDown={
                            playable
                              ? (e) => {
                                  if (e.key === "Enter" || e.key === " ")
                                    move(open.serverId, open.opponent, r, c);
                                }
                              : undefined
                          }
                          tabIndex={playable ? 0 : -1}
                          className={`w-20 h-20 text-4xl font-bold text-center border-4 border-discord-dark-100 select-none ${
                            playable
                              ? "cursor-pointer hover:bg-discord-dark-300"
                              : ""
                          } ${
                            win ? "bg-discord-green text-white" : "text-white"
                          }`}
                        >
                          {cell}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="text-center text-sm text-white min-h-[1.25rem]">
          {game.statusMessage}
        </div>

        {game.gameOver && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => closeModal()}
              className="button-primary px-4 py-2 rounded text-sm"
            >
              <Trans>Close</Trans>
            </button>
          </div>
        )}

        {!game.gameOver && game.active && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded bg-discord-red text-white text-sm"
            >
              <Trans>Forfeit</Trans>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TicTacToeModal;
