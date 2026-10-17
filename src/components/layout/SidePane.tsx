import type React from "react";
import useStore from "../../store";
import { MemberList } from "./MemberList";
import ProfilePane from "./ProfilePane";

// The right-hand pane shows an open profile in place of the member list, so
// both share one slot: the resizable sidebar, the narrow overlay and the phone page.
export const SidePane: React.FC = () => {
  const profilePane = useStore((s) => s.ui.profilePane);
  return profilePane ? <ProfilePane target={profilePane} /> : <MemberList />;
};

export default SidePane;
