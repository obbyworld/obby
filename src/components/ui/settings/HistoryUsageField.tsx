import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useState } from "react";
import { clearHistory, usageBytes } from "../../../lib/history/historyDb";
import BaseModal from "../../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../../lib/modal/components";
import { clearRecents } from "../../../lib/search/recents";
import type { SettingComponentProps } from "../../../lib/settings/types";
import useStore from "../../../store";
import { BYTES_PER_MB } from "../../../store/handlers/history";

export const HistoryUsageField: React.FC<SettingComponentProps> = ({
  disabled,
}) => {
  const { t } = useLingui();
  const isKeepingHistory = useStore(
    (s) => s.globalSettings.keepHistory !== false,
  );
  const [bytes, setBytes] = useState<number | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    usageBytes().then((used) => {
      if (!isCancelled) setBytes(used);
    });
    return () => {
      isCancelled = true;
    };
  }, []);

  const handleClear = async () => {
    setIsConfirming(false);
    clearRecents();
    await clearHistory();
    setBytes(await usageBytes());
  };

  const kb = ((bytes ?? 0) / 1000).toFixed(1);
  const mb = ((bytes ?? 0) / BYTES_PER_MB).toFixed(1);
  const usageText =
    bytes === null
      ? ""
      : bytes === 0
        ? isKeepingHistory
          ? t`Chat to start saving history`
          : t`Turn on Keep chat history to start saving`
        : bytes < BYTES_PER_MB
          ? t`${kb} KB used`
          : t`${mb} MB used`;

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-discord-text-muted">{usageText}</span>
      <button
        type="button"
        onClick={() => setIsConfirming(true)}
        disabled={disabled}
        className="rounded px-3 py-1.5 text-sm disabled:opacity-50 bg-discord-dark-400 hover:bg-red-900/40 text-discord-text-muted hover:text-red-300"
      >
        <Trans>Clear history</Trans>
      </button>
      <BaseModal
        isOpen={isConfirming}
        onClose={() => setIsConfirming(false)}
        maxWidth="md"
        title={<Trans>Clear all saved history?</Trans>}
      >
        <ModalBody>
          <p className="text-sm text-discord-text-muted">
            <Trans>
              Delete every saved message on this device. You cannot undo this.
            </Trans>
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsConfirming(false)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button variant="danger" onClick={handleClear}>
            <Trans>Clear history</Trans>
          </Button>
        </ModalFooter>
      </BaseModal>
    </div>
  );
};
