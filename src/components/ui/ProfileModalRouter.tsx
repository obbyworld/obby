/**
 * ProfileModalRouter
 *
 * Picks the right profile-modal component based on whether the active
 * server has negotiated the obby.world/whois capability. Servers that
 * advertise the cap render the new multi-session-aware ObbyWhoisModal;
 * everyone else continues to get the legacy UserProfileModal. Lets the
 * five mount sites in the app stay simple — they just import this
 * component and pass props through.
 */
import type React from "react";
import useStore from "../../store";
import ObbyWhoisModal from "./ObbyWhoisModal";
import UserProfileModal from "./UserProfileModal";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  serverId: string;
  username: string;
  /** Optional back-nav used by nested-modal entry points (UserSettings). */
  onBack?: () => void;
  /** Deep-link into the BotsModal pre-selected on this user. */
  onShowInBotsMenu?: (botNick: string) => void;
}

const ProfileModalRouter: React.FC<Props> = ({
  isOpen,
  onClose,
  serverId,
  username,
  onBack,
  onShowInBotsMenu,
}) => {
  const useObby = useStore((state) => {
    const srv = state.servers.find((s) => s.id === serverId);
    return !!srv?.capabilities?.includes("obby.world/whois");
  });

  if (useObby) {
    return (
      <ObbyWhoisModal
        isOpen={isOpen}
        onClose={onClose}
        serverId={serverId}
        username={username}
        onBack={onBack}
        onShowInBotsMenu={onShowInBotsMenu}
      />
    );
  }
  return (
    <UserProfileModal
      isOpen={isOpen}
      onClose={onClose}
      serverId={serverId}
      username={username}
      onBack={onBack}
      onShowInBotsMenu={onShowInBotsMenu}
    />
  );
};

export default ProfileModalRouter;
