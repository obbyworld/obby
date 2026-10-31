import { t } from "@lingui/core/macro";
import type React from "react";
import useStore from "../../store";
import { PageShell } from "../ui/page/PageShell";
import ChannelBrowser from "./ChannelBrowser";
import type { PageProps } from "./PageHost";

const ChannelBrowserPage: React.FC<PageProps<"channelBrowser">> = ({
  page,
}) => {
  const closePage = useStore((s) => s.closePage);
  return (
    <ChannelBrowser serverId={page.serverId} onLeave={closePage}>
      {(count, body) => (
        <PageShell title={t`Browse channels`} wide headerActions={count}>
          {body}
        </PageShell>
      )}
    </ChannelBrowser>
  );
};

export default ChannelBrowserPage;
