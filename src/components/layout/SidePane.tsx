import type React from "react";
import useStore from "../../store";
import BotPane from "./BotPane";
import { MemberList } from "./MemberList";
import ProfilePane from "./ProfilePane";
import SearchPane from "./SearchPane";

// The right-hand pane shows search results or an open profile or bot in place of the
// member list, so all three share one slot: the resizable sidebar, the narrow
// overlay and the phone page. Only one pane is open at a time, so the newest shows.
export const SidePane: React.FC = () => {
  const sidePane = useStore((s) => s.ui.sidePane);
  if (sidePane?.kind === "search")
    return <SearchPane key={sidePane.session} query={sidePane.query} />;
  if (sidePane?.kind === "profile") return <ProfilePane target={sidePane} />;
  if (sidePane?.kind === "bot") return <BotPane target={sidePane} />;
  return <MemberList />;
};

export default SidePane;
