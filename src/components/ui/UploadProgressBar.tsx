import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useState } from "react";
import {
  FaCheck,
  FaChevronDown,
  FaChevronUp,
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

const isActiveJob = (job: UploadJob) =>
  job.status === "pending" || job.status === "uploading";

const JobStatusIcon: React.FC<{ status: UploadJob["status"] }> = ({
  status,
}) =>
  status === "done" ? (
    <FaCheck className="w-3.5 h-3.5 text-discord-green shrink-0" />
  ) : status === "failed" ? (
    <FaTimes className="w-3.5 h-3.5 text-discord-red shrink-0" />
  ) : (
    <FaSpinner className="w-3.5 h-3.5 animate-spin text-discord-primary shrink-0" />
  );

const JobBytes: React.FC<{ job: UploadJob }> = ({ job }) => (
  <span className="text-xs row-meta whitespace-nowrap">
    {job.status === "failed" ? (
      <Trans>failed</Trans>
    ) : job.status === "done" ? (
      <Trans>done</Trans>
    ) : (
      `${formatFileSize(job.loaded)} / ${formatFileSize(job.total || job.file.size)}`
    )}
  </span>
);

const EncryptionNote: React.FC<{ job: UploadJob }> = ({ job }) =>
  job.encrypted ? (
    <span className="flex items-center gap-1 text-xs text-discord-green">
      <FaLock />
      <Trans>Encrypted</Trans>
    </span>
  ) : (
    <span className="flex items-center gap-1 text-xs text-amber-400">
      <FaLockOpen />
      {job.plainReason === "too-large" ? (
        <Trans>Sent unencrypted because the file is too large to encrypt</Trans>
      ) : job.plainReason === "scheme" ? (
        <Trans>Sent unencrypted because OTR encrypts text only</Trans>
      ) : (
        <Trans>Not encrypted</Trans>
      )}
    </span>
  );

// We show uploads as one line in the strip under the header, so the end of the chat stays visible.
export const UploadProgressBar: React.FC<Props> = ({ jobs, onCancel }) => {
  const { t } = useLingui();
  const [isExpanded, setIsExpanded] = useState(false);
  if (jobs.length === 0) return null;

  const single = jobs.length === 1 ? jobs[0] : null;
  const activeCount = jobs.filter(isActiveJob).length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;
  const loaded = jobs.reduce((sum, job) => sum + job.loaded, 0);
  const total = jobs.reduce(
    (sum, job) => sum + (job.total || job.file.size),
    0,
  );
  const pct = total > 0 ? Math.min(100, (loaded / total) * 100) : 0;
  const hasPlainUpload = jobs.some((job) => job.encrypted === false);
  const summaryStatus: UploadJob["status"] =
    activeCount > 0 ? "uploading" : failedCount > 0 ? "failed" : "done";

  return (
    <div className="shrink-0 border-b border-discord-dark-400 bg-discord-dark-300 animate-in slide-in-from-top-2 duration-200">
      <div className="relative h-9 flex items-center gap-2 px-3 min-w-0">
        <JobStatusIcon status={summaryStatus} />
        <FaFile className="w-3 h-3 text-discord-text-muted shrink-0" />
        <span
          className="flex-1 min-w-0 truncate text-xs text-discord-text-normal"
          title={single?.file.name}
        >
          {single ? (
            single.file.name
          ) : activeCount > 0 ? (
            <Plural
              value={activeCount}
              one="Uploading 1 file"
              other="Uploading # files"
            />
          ) : failedCount > 0 ? (
            <Plural
              value={failedCount}
              one="1 upload failed"
              other="# uploads failed"
            />
          ) : (
            <Trans>Uploaded</Trans>
          )}
        </span>
        {hasPlainUpload && !isExpanded && (
          <FaLockOpen className="w-3 h-3 text-amber-400 shrink-0" />
        )}
        {single ? (
          <JobBytes job={single} />
        ) : (
          <span className="text-xs row-meta whitespace-nowrap">
            {`${formatFileSize(loaded)} / ${formatFileSize(total)}`}
          </span>
        )}
        {!single && (
          <button
            type="button"
            onClick={() => setIsExpanded((open) => !open)}
            className="icon-button w-6 h-6 rounded shrink-0"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? t`Collapse` : t`Expand`}
            title={isExpanded ? t`Collapse` : t`Expand`}
          >
            {isExpanded ? (
              <FaChevronUp className="w-3 h-3" />
            ) : (
              <FaChevronDown className="w-3 h-3" />
            )}
          </button>
        )}
        {single && onCancel && single.status !== "done" && (
          <button
            type="button"
            onClick={() => onCancel(single.id)}
            className="icon-button w-6 h-6 rounded shrink-0"
            aria-label={t`Cancel upload`}
            title={t`Cancel upload`}
          >
            <FaTimes className="w-3 h-3" />
          </button>
        )}
        {activeCount > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/5">
            <div
              className="h-full bg-discord-primary transition-[width] duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
      {single && (single.encrypted !== undefined || single.error) && (
        <div className="px-3 pb-1.5 pl-[3.25rem] flex flex-col gap-0.5">
          {single.encrypted !== undefined && <EncryptionNote job={single} />}
          {single.error && (
            <p className="text-xs text-discord-red">{single.error}</p>
          )}
        </div>
      )}
      {!single && isExpanded && (
        <div className="max-h-40 overflow-y-auto border-t border-white/5">
          {jobs.map((job) => (
            <div key={job.id} className="px-3 py-1.5 pl-8">
              <div className="flex items-center gap-2 min-w-0">
                <JobStatusIcon status={job.status} />
                <span
                  className="flex-1 min-w-0 truncate text-xs text-discord-text-normal"
                  title={job.file.name}
                >
                  {job.file.name}
                </span>
                <JobBytes job={job} />
                {onCancel && job.status !== "done" && (
                  <button
                    type="button"
                    onClick={() => onCancel(job.id)}
                    className="icon-button w-6 h-6 rounded shrink-0"
                    aria-label={t`Cancel upload`}
                    title={t`Cancel upload`}
                  >
                    <FaTimes className="w-3 h-3" />
                  </button>
                )}
              </div>
              {job.encrypted !== undefined && (
                <div className="pl-5">
                  <EncryptionNote job={job} />
                </div>
              )}
              {job.error && (
                <p className="text-xs text-discord-red pl-5">{job.error}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UploadProgressBar;
