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
  FaTimes,
} from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
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
  ) : null;

const ProgressTrack: React.FC<{ percent: number; isFailed: boolean }> = ({
  percent,
  isFailed,
}) => (
  <div className="h-1.5 rounded-full bg-discord-dark-500 overflow-hidden">
    <div
      className={`h-full rounded-full ${isFailed ? "bg-discord-red" : "bg-discord-primary"}`}
      style={{ width: `${percent}%` }}
    />
  </div>
);

const jobPercent = (job: UploadJob) =>
  job.total > 0 ? Math.min(100, (job.loaded / job.total) * 100) : 0;

const JobBytes: React.FC<{ job: UploadJob }> = ({ job }) => (
  <span className="row-meta whitespace-nowrap">
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

const BarButton: React.FC<{
  label: string;
  onClick: () => void;
  isExpanded?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, isExpanded, children }) => {
  const isTouch = useIsTouchInput();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`icon-button ${isTouch ? "w-11 h-11" : "w-6 h-6"}`}
      aria-label={label}
      title={label}
      aria-expanded={isExpanded}
    >
      {children}
    </button>
  );
};

// We show uploads as one line in the strip under the header, so the end of the chat stays visible.
export const UploadProgressBar: React.FC<Props> = ({ jobs, onCancel }) => {
  const { t } = useLingui();
  const [isExpanded, setIsExpanded] = useState(false);
  const isTouch = useIsTouchInput();
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
      <div
        className={`relative flex items-center gap-2 px-3 min-w-0 ${isTouch ? "h-11" : "h-9"}`}
      >
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
        {hasPlainUpload && !single && !isExpanded && (
          <FaLockOpen className="w-3 h-3 text-amber-400 shrink-0" />
        )}
        {single ? (
          <JobBytes job={single} />
        ) : (
          <span className="row-meta whitespace-nowrap">
            {`${formatFileSize(loaded)} / ${formatFileSize(total)}`}
          </span>
        )}
        {!single && (
          <BarButton
            label={isExpanded ? t`Collapse` : t`Expand`}
            onClick={() => setIsExpanded((open) => !open)}
            isExpanded={isExpanded}
          >
            {isExpanded ? (
              <FaChevronUp className="w-3 h-3" />
            ) : (
              <FaChevronDown className="w-3 h-3" />
            )}
          </BarButton>
        )}
        {single && onCancel && single.status !== "done" && (
          <BarButton
            label={t`Cancel upload`}
            onClick={() => onCancel(single.id)}
          >
            <FaTimes className="w-3 h-3" />
          </BarButton>
        )}
      </div>
      {summaryStatus !== "done" && (
        <div className="px-3 pb-2">
          <ProgressTrack percent={pct} isFailed={summaryStatus === "failed"} />
        </div>
      )}
      {single && (single.encrypted !== undefined || single.error) && (
        <div className="px-3 pb-2 flex flex-col gap-0.5">
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
                  <BarButton
                    label={t`Cancel upload`}
                    onClick={() => onCancel(job.id)}
                  >
                    <FaTimes className="w-3 h-3" />
                  </BarButton>
                )}
              </div>
              {job.encrypted !== undefined && <EncryptionNote job={job} />}
              {job.status !== "done" && (
                <div className="mt-1">
                  <ProgressTrack
                    percent={jobPercent(job)}
                    isFailed={job.status === "failed"}
                  />
                </div>
              )}
              {job.error && (
                <p className="text-xs text-discord-red">{job.error}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UploadProgressBar;
