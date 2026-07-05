import { Trans, useLingui } from "@lingui/react/macro";
import { FaLockOpen } from "react-icons/fa";
import { HoverTooltip } from "../ui/HoverTooltip";

// The single lock shown at the top of an unencrypted message group. obbyircd is
// multi-client, so an unprotected run routinely means the peer replied from a
// second client that isn't encrypting — hence the neutral wording. Hover reveals
// the explanation, mirroring the reaction tooltip.
export function E2EEUnprotectedBadge() {
  const { t } = useLingui();

  return (
    <HoverTooltip
      className="ml-2 align-middle text-amber-400"
      content={
        <span className="flex items-start gap-2">
          <FaLockOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <Trans>
            This message wasn't encrypted. It may come from another of their
            clients that isn't using encryption.
          </Trans>
        </span>
      }
    >
      <span
        role="img"
        aria-label={t`Not encrypted`}
        className="inline-flex items-center"
      >
        <FaLockOpen className="h-3.5 w-3.5" />
      </span>
    </HoverTooltip>
  );
}
