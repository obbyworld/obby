import { Trans } from "@lingui/react/macro";
import type React from "react";
import type { WebPushFailure } from "../../../types";

export const WebPushFailureLine: React.FC<{ failure: WebPushFailure }> = ({
  failure,
}) => (
  <p role="status" className="text-[13px] text-discord-yellow">
    {failure === "timed-out" ? (
      <Trans>
        Restart your browser to get notifications while Obby is closed
      </Trans>
    ) : (
      <Trans>Keep Obby open to get notifications</Trans>
    )}
  </p>
);
