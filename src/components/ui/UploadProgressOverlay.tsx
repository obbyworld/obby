// Progress strip rendered above the chat input while files are
// uploading.  Each row shows the file name, a determinate bar driven
// by XHR's upload-progress event, and a "done" / "failed" mark when
// the upload settles.

import { Trans } from "@lingui/react/macro";
import type React from "react";
import {
  FaCheck,
  FaFile,
  FaLock,
  FaLockOpen,
  FaSpinner,
  FaTimes,
} from "react-icons/fa";
import type { PlainUploadReason } from "../../lib/e2ee/media";
import { formatFileSize } from "../../lib/mediaUpload";

export interface UploadJob {
  id: string;
  file: File;
  loaded: number;
  total: number;
  status: "pending" | "uploading" | "done" | "failed";
  error?: string;
  url?: string;
  // Set only where encryption was available, so a channel upload stays quiet
  // and a plain upload inside a locked conversation stands out.
  encrypted?: boolean;
  plainReason?: PlainUploadReason;
}

interface Props {
  jobs: UploadJob[];
  onCancel?: (id: string) => void;
}

export const UploadProgressOverlay: React.FC<Props> = ({ jobs, onCancel }) => {
  if (jobs.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 px-2 z-20">
      <div className="bg-discord-dark-300 rounded-md shadow-lg border border-discord-dark-200 p-2 space-y-2">
        <div className="text-xs text-discord-text-muted font-semibold uppercase tracking-wide px-1">
          {jobs.length === 1
            ? "Uploading 1 file"
            : `Uploading ${jobs.length} files`}
        </div>
        {jobs.map((job) => {
          const pct =
            job.total > 0 ? Math.min(100, (job.loaded / job.total) * 100) : 0;
          return (
            <div key={job.id} className="text-sm">
              <div className="flex items-center gap-2">
                {job.status === "done" ? (
                  <FaCheck className="text-discord-green flex-shrink-0" />
                ) : job.status === "failed" ? (
                  <FaTimes className="text-discord-red flex-shrink-0" />
                ) : (
                  <FaSpinner className="animate-spin text-discord-blue flex-shrink-0" />
                )}
                <FaFile className="text-discord-text-muted flex-shrink-0" />
                <span className="truncate flex-1 text-white text-xs">
                  {job.file.name}
                </span>
                <span className="text-xs text-discord-text-muted whitespace-nowrap">
                  {job.status === "failed"
                    ? "failed"
                    : job.status === "done"
                      ? "done"
                      : `${formatFileSize(job.loaded)} / ${formatFileSize(job.total || job.file.size)}`}
                </span>
                {onCancel && job.status !== "done" && (
                  <button
                    type="button"
                    onClick={() => onCancel(job.id)}
                    className="text-discord-text-muted hover:text-white text-xs"
                    aria-label="Cancel upload"
                  >
                    ✕
                  </button>
                )}
              </div>
              {job.encrypted !== undefined && (
                <div className="mt-0.5 flex items-center gap-1 pl-6 text-xs">
                  {job.encrypted ? (
                    <>
                      <FaLock className="text-discord-green" />
                      <span className="text-discord-green">
                        <Trans>Encrypted</Trans>
                      </span>
                    </>
                  ) : (
                    <>
                      <FaLockOpen className="text-amber-400" />
                      <span className="text-amber-400">
                        {job.plainReason === "too-large" ? (
                          <Trans>Too large to encrypt, sent unencrypted</Trans>
                        ) : job.plainReason === "scheme" ? (
                          <Trans>OTR does not encrypt files, sent as-is</Trans>
                        ) : (
                          <Trans>Not encrypted</Trans>
                        )}
                      </span>
                    </>
                  )}
                </div>
              )}
              {job.status !== "done" && (
                <div className="w-full mt-1 h-1.5 rounded bg-discord-dark-500 overflow-hidden">
                  <div
                    className={`h-full transition-[width] duration-150 ${
                      job.status === "failed"
                        ? "bg-discord-red"
                        : "bg-discord-blue"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
              {job.error && (
                <p className="text-xs text-discord-red mt-1">{job.error}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default UploadProgressOverlay;
