import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useMemo } from "react";
import { isLocalTurn, isWinningCell } from "../../lib/games/tictactoe";
import { BaseModal } from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";
import useStore from "../../store";

export const TicTacToeModal: React.FC = () => {
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
  const forfeit = () => {
    terminate(open.serverId, open.opponent);
    closeModal();
  };

  return (
    <BaseModal
      isOpen
      onClose={() => closeModal()}
      closeOnClickOutside={false}
      closeOnEsc={false}
      maxWidth="sm"
      title={<Trans>Tic-Tac-Toe vs {open.opponent}</Trans>}
    >
      <ModalBody className="space-y-4">
        {game.inviteIncoming && (
          <p className="text-sm text-white">
            <Trans>{open.opponent} has invited you to play.</Trans>
          </p>
        )}

        {game.invitePending && !game.active && (
          <p className="text-sm text-white">
            <Trans>Waiting for {open.opponent} to accept…</Trans>
          </p>
        )}

        {(game.active || game.gameOver) && (
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
                        } ${win ? "bg-discord-green text-white" : "text-white"}`}
                      >
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="text-center text-sm text-white min-h-[1.25rem]">
          {game.statusMessage}
        </div>
      </ModalBody>

      {game.inviteIncoming && (
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => decline(open.serverId, open.opponent)}
          >
            <Trans>Decline</Trans>
          </Button>
          <Button onClick={() => accept(open.serverId, open.opponent)}>
            <Trans>Accept</Trans>
          </Button>
        </ModalFooter>
      )}

      {game.gameOver && (
        <ModalFooter>
          <Button onClick={() => closeModal()}>
            <Trans>Close</Trans>
          </Button>
        </ModalFooter>
      )}

      {!game.gameOver && game.active && (
        <ModalFooter>
          <Button variant="danger" onClick={forfeit}>
            <Trans>Forfeit</Trans>
          </Button>
        </ModalFooter>
      )}
    </BaseModal>
  );
};

export default TicTacToeModal;
