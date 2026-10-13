import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useMemo, useState } from "react";
import {
  FaCheck,
  FaChevronDown,
  FaChevronUp,
  FaLock,
  FaLockOpen,
  FaSpinner,
  FaTimes,
} from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { isStale } from "../../lib/botTools";
import type { PlainUploadReason } from "../../lib/e2ee/media";
import { formatFileSize } from "../../lib/mediaUpload";
import type { AiWorkflow } from "../../store";
import useStore from "../../store";
import { AudioControls } from "./MiniMediaPlayer";

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

interface ComposerDockProps {
  jobs: UploadJob[];
  onCancel: (id: string) => void;
  serverId: string | null;
  channel: string | null;
}

const VISIBLE_WHEN_COLLAPSED = 2;

const isRunning = (w: AiWorkflow) =>
  !w.historical &&
  !isStale(w) &&
  (w.state === "start" || w.state === "reasoning" || w.state === "running");

const isUnsettled = (job: UploadJob) =>
  job.status === "pending" || job.status === "uploading";

export const ComposerDock: React.FC<ComposerDockProps> = ({
  jobs,
  onCancel,
  serverId,
  channel,
}) => {
  const { t } = useLingui();
  const isTouch = useIsTouchInput();
  const serverWorkflows = useStore((s) =>
    serverId ? s.aiWorkflows[serverId] : undefined,
  );
  const reopenWorkflow = useStore((s) => s.aiWorkflowReopen);
  const hasAudio = useStore(
    (s) => s.ui.activeMedia?.type === "audio" && s.ui.openedMedia === null,
  );
  const [filesShown, setFilesShown] = useState(false);
  const [allShown, setAllShown] = useState(false);

  const workflows = useMemo(() => {
    if (!serverWorkflows || !channel) return [];
    return Object.values(serverWorkflows)
      .filter((w) => w.channel === channel && isRunning(w))
      .sort((a, b) => b.startedAt - a.startedAt);
  }, [serverWorkflows, channel]);

  const rowClass = `relative flex items-center gap-2 px-2 text-xs text-discord-text-normal ${isTouch ? "min-h-11" : "h-9"}`;
  const buttonClass = `icon-button ${isTouch ? "w-11 h-11" : ""}`;
  const mainClass =
    "flex min-w-0 flex-1 items-center gap-2 self-stretch rounded px-1 text-left hover:text-white focus-visible:outline-none focus-visible:bg-discord-dark-500/40";

  const stepText = (w: AiWorkflow) => {
    const step = w.steps[w.steps.length - 1];
    if (step?.label) return step.label;
    if (step?.tool) return step.tool;
    return w.state === "reasoning" ? t`Thinking` : t`Starting`;
  };

  const rows: { key: string; node: React.ReactNode }[] = [];

  if (jobs.length > 0) {
    const active = jobs.filter(isUnsettled);
    const activeCount = active.length;
    const failedCount = jobs.filter((j) => j.status === "failed").length;
    const loaded = active.reduce((sum, j) => sum + j.loaded, 0);
    const total = active.reduce((sum, j) => sum + (j.total || j.file.size), 0);
    const pct = total > 0 ? Math.min(100, (loaded / total) * 100) : 0;
    const hasPlain = jobs.some((j) => j.encrypted === false);
    rows.push({
      key: "uploads",
      node: (
        <div>
          <div className={rowClass}>
            <button
              type="button"
              className={mainClass}
              aria-expanded={filesShown}
              onClick={() => setFilesShown((v) => !v)}
              title={filesShown ? t`Hide files` : t`Show files`}
            >
              {activeCount > 0 ? (
                <FaSpinner className="shrink-0 animate-spin text-discord-primary" />
              ) : failedCount > 0 ? (
                <FaTimes className="shrink-0 text-discord-red" />
              ) : (
                <FaCheck className="shrink-0 text-discord-green" />
              )}
              <span className="min-w-0 truncate font-medium">
                {activeCount > 0 ? (
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
              {hasPlain && (
                <span
                  className="shrink-0 text-amber-400"
                  title={t`Not encrypted`}
                >
                  <FaLockOpen />
                </span>
              )}
              {activeCount > 0 && (
                <span className="row-meta ml-auto shrink-0 whitespace-nowrap tabular-nums">
                  {`${formatFileSize(loaded)} / ${formatFileSize(total)}`}
                </span>
              )}
              {filesShown ? (
                <FaChevronUp
                  className={`shrink-0 text-[10px] text-discord-text-muted ${activeCount > 0 ? "" : "ml-auto"}`}
                />
              ) : (
                <FaChevronDown
                  className={`shrink-0 text-[10px] text-discord-text-muted ${activeCount > 0 ? "" : "ml-auto"}`}
                />
              )}
            </button>
            {activeCount > 0 && (
              <button
                type="button"
                className={buttonClass}
                aria-label={t`Cancel all uploads`}
                title={t`Cancel all uploads`}
                onClick={() => {
                  for (const job of active) onCancel(job.id);
                }}
              >
                <FaTimes className="text-xs" />
              </button>
            )}
            {activeCount > 0 && (
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-discord-dark-500/40">
                <div
                  className="h-full bg-discord-primary transition-[width] duration-150"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
          {filesShown && (
            <ul className="max-h-[40vh] overflow-y-auto pb-1">
              {jobs.map((job) => (
                <UploadFileRow
                  key={job.id}
                  job={job}
                  rowClass={rowClass}
                  buttonClass={buttonClass}
                  onCancel={onCancel}
                />
              ))}
            </ul>
          )}
        </div>
      ),
    });
  }

  for (const w of workflows) {
    rows.push({
      key: `workflow-${w.id}`,
      node: (
        <div className={rowClass}>
          <button
            type="button"
            className={mainClass}
            onClick={() => reopenWorkflow(w.serverId, w.id)}
            title={t`Open workflow`}
          >
            <FaSpinner className="shrink-0 animate-spin text-blue-400" />
            <span className="shrink-0 font-medium">{w.senderNick}</span>
            {w.name && (
              <span className="min-w-0 shrink truncate">{w.name}</span>
            )}
            <span className="row-meta min-w-0 flex-1 truncate">
              {stepText(w)}
            </span>
          </button>
        </div>
      ),
    });
  }

  if (hasAudio) {
    rows.push({
      key: "audio",
      node: (
        <div className={`${rowClass} pl-1`}>
          <AudioControls buttonClassName={buttonClass} />
        </div>
      ),
    });
  }

  if (rows.length === 0) return null;

  const collapsible = rows.length > VISIBLE_WHEN_COLLAPSED + 1;
  const shown =
    collapsible && !allShown ? rows.slice(0, VISIBLE_WHEN_COLLAPSED) : rows;
  const hiddenCount = rows.length - VISIBLE_WHEN_COLLAPSED;

  return (
    <section
      aria-label={t`Activity`}
      className="mb-2 divide-y divide-white/[0.06] overflow-hidden rounded-lg bg-discord-dark-100"
    >
      {shown.map((row) => (
        <div key={row.key}>{row.node}</div>
      ))}
      {collapsible && (
        <div className={rowClass}>
          <button
            type="button"
            className={`${mainClass} row-meta justify-center`}
            aria-expanded={allShown}
            onClick={() => setAllShown((v) => !v)}
          >
            {allShown ? (
              <>
                <FaChevronUp className="text-[10px]" />
                <Trans>Show less</Trans>
              </>
            ) : (
              <>
                <FaChevronDown className="text-[10px]" />
                <Trans>Show {hiddenCount} more</Trans>
              </>
            )}
          </button>
        </div>
      )}
    </section>
  );
};

const UploadFileRow: React.FC<{
  job: UploadJob;
  rowClass: string;
  buttonClass: string;
  onCancel: (id: string) => void;
}> = ({ job, rowClass, buttonClass, onCancel }) => {
  const { t } = useLingui();
  return (
    <li className="pl-6">
      <div className={rowClass}>
        {job.status === "done" ? (
          <FaCheck className="shrink-0 text-discord-green" />
        ) : job.status === "failed" ? (
          <FaTimes className="shrink-0 text-discord-red" />
        ) : (
          <FaSpinner className="shrink-0 animate-spin text-discord-text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate" title={job.file.name}>
          {job.file.name}
        </span>
        <span
          className={`row-meta shrink-0 whitespace-nowrap tabular-nums ${job.status === "failed" ? "text-discord-red" : ""}`}
        >
          {job.status === "failed" ? (
            <Trans>failed</Trans>
          ) : job.status === "done" ? (
            <Trans>done</Trans>
          ) : (
            `${formatFileSize(job.loaded)} / ${formatFileSize(job.total || job.file.size)}`
          )}
        </span>
        {job.status !== "done" && (
          <button
            type="button"
            className={buttonClass}
            onClick={() => onCancel(job.id)}
            aria-label={t`Cancel upload`}
            title={t`Cancel upload`}
          >
            <FaTimes className="text-xs" />
          </button>
        )}
      </div>
      {(job.encrypted !== undefined || job.error) && (
        <div className="flex flex-col gap-0.5 px-3 pb-1.5 text-xs">
          {job.encrypted === true && (
            <span className="flex items-center gap-1 text-discord-green">
              <FaLock className="shrink-0" />
              <Trans>Encrypted</Trans>
            </span>
          )}
          {job.encrypted === false && (
            <span className="flex items-center gap-1 text-amber-400">
              <FaLockOpen className="shrink-0" />
              {job.plainReason === "too-large" ? (
                <Trans>
                  Sent unencrypted because the file is too large to encrypt
                </Trans>
              ) : job.plainReason === "scheme" ? (
                <Trans>Sent unencrypted because OTR encrypts text only</Trans>
              ) : (
                <Trans>Not encrypted</Trans>
              )}
            </span>
          )}
          {job.error && (
            <span className="break-words text-discord-red">{job.error}</span>
          )}
        </div>
      )}
    </li>
  );
};

export default ComposerDock;
