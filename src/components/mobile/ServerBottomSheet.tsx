import { Trans } from "@lingui/react/macro";
import type React from "react";
import { FaPencilAlt, FaSignOutAlt } from "react-icons/fa";
import BottomSheet from "./BottomSheet";

interface ServerBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  serverName: string;
  onEdit: () => void;
  onDisconnect: () => void;
}

const ServerBottomSheet: React.FC<ServerBottomSheetProps> = ({
  isOpen,
  onClose,
  serverName,
  onEdit,
  onDisconnect,
}) => {
  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <div className="px-4 pb-2">
        <span className="text-sm text-discord-text-muted">{serverName}</span>
      </div>
      <div className="px-2 pb-2">
        <button
          type="button"
          className="sheet-row"
          onClick={() => {
            onEdit();
            onClose();
          }}
        >
          <span className="text-lg">
            <FaPencilAlt />
          </span>
          <span>
            <Trans>Edit Server</Trans>
          </span>
        </button>
        <button
          type="button"
          className="sheet-row text-red-400"
          onClick={() => {
            onDisconnect();
            onClose();
          }}
        >
          <span className="text-lg">
            <FaSignOutAlt />
          </span>
          <span>
            <Trans>Disconnect</Trans>
          </span>
        </button>
      </div>
    </BottomSheet>
  );
};

export default ServerBottomSheet;
