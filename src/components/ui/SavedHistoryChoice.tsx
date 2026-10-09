import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useState } from "react";
import { hasSavedHistory } from "../../store/handlers/history";

// Disconnect dialogs offer this only when one of the servers going away has
// saved history, which otherwise waits for that network to be added again.
export const SavedHistoryChoice: React.FC<{
  serverIds: string[];
  shouldDelete: boolean;
  onChange: (shouldDelete: boolean) => void;
}> = ({ serverIds, shouldDelete, onChange }) => {
  const [hasHistory, setHasHistory] = useState(false);
  const idsKey = serverIds.join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: idsKey stands for serverIds
  useEffect(() => {
    let isCancelled = false;
    Promise.all(serverIds.map(hasSavedHistory))
      .then((found) => {
        if (!isCancelled) setHasHistory(found.some(Boolean));
      })
      .catch(() => {
        if (!isCancelled) setHasHistory(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [idsKey]);

  if (!hasHistory) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-discord-text-muted">
        <Trans>
          Add this network again to get its saved chat history back.
        </Trans>
      </p>
      <label className="flex items-center gap-2 text-sm text-discord-text-normal">
        <input
          type="checkbox"
          checked={shouldDelete}
          onChange={(event) => onChange(event.target.checked)}
          className="accent-discord-primary rounded"
        />
        <Trans>Delete its saved chat history too</Trans>
      </label>
    </div>
  );
};
