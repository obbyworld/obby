import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useState } from "react";
import { FaDownload, FaSyncAlt } from "react-icons/fa";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";
import {
  type AvailableUpdate,
  checkForUpdate,
  relaunchApp,
} from "../../lib/updater";

type Status = "available" | "downloading" | "error";

// Desktop-only in-app updater (CrabNebula Cloud). Renders nothing on web/mobile
// because checkForUpdate() resolves to null off Tauri desktop.
const UpdateModal: React.FC = () => {
  const { t } = useLingui();
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [status, setStatus] = useState<Status>("available");
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    checkForUpdate()
      .then((result) => {
        if (!cancelled && result) setUpdate(result);
      })
      .catch(() => {
        // A failed check should never block the app; stay silent.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update) return null;

  const handleInstall = async () => {
    setStatus("downloading");
    setPercent(null);
    try {
      await update.downloadAndInstall((downloaded, total) => {
        setPercent(total ? Math.round((downloaded / total) * 100) : null);
      });
      await relaunchApp();
    } catch {
      setStatus("error");
    }
  };

  const busy = status === "downloading";

  return (
    <BaseModal
      isOpen={true}
      onClose={busy ? () => {} : () => setUpdate(null)}
      title={
        <div className="flex items-center gap-3">
          <FaDownload className="text-discord-primary text-xl flex-shrink-0" />
          <span>
            <Trans>Update available</Trans>
          </span>
        </div>
      }
      maxWidth="md"
    >
      <ModalBody>
        <div className="space-y-4">
          <p className="text-discord-text-normal">
            {t`Version ${update.version} is available — you have ${update.currentVersion}.`}
          </p>

          {update.notes && (
            <div className="bg-discord-dark-400 rounded p-3 max-h-48 overflow-y-auto">
              <p className="text-xs font-semibold text-discord-text-muted mb-1">
                <Trans>Release notes</Trans>
              </p>
              <pre className="text-sm text-discord-text-normal whitespace-pre-wrap break-words font-sans">
                {update.notes}
              </pre>
            </div>
          )}

          {status === "downloading" && (
            <div className="space-y-2">
              <p className="text-sm text-discord-text-muted">
                {percent === null ? (
                  <Trans>Downloading…</Trans>
                ) : (
                  t`Downloading… ${percent}%`
                )}
              </p>
              <div className="w-full bg-discord-dark-500 rounded h-2 overflow-hidden">
                <div
                  className="bg-discord-primary h-2 transition-all"
                  style={{ width: `${percent ?? 10}%` }}
                />
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="bg-discord-red bg-opacity-10 border border-discord-red border-opacity-30 rounded p-3">
              <p className="text-sm text-discord-red">
                <Trans>Update failed. Please try again.</Trans>
              </p>
            </div>
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => setUpdate(null)}
        >
          <Trans>Later</Trans>
        </Button>
        <Button variant="primary" disabled={busy} onClick={handleInstall}>
          <FaSyncAlt className="inline mr-2 text-sm" />
          {status === "error" ? (
            <Trans>Retry</Trans>
          ) : (
            <Trans>Install and restart</Trans>
          )}
        </Button>
      </ModalFooter>
    </BaseModal>
  );
};

export default UpdateModal;
