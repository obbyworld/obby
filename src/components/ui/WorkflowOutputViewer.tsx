import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useState } from "react";
import BaseModal from "../../lib/modal/BaseModal";
import { indentPartialJson, type StepContent } from "../../lib/workflowFormat";
import CopyButton from "./CopyButton";
import JsonTree, { JsonText } from "./JsonTree";
import { SegmentedControl } from "./SegmentedControl";

interface WorkflowOutputViewerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  content: StepContent;
}

type ViewMode = "tree" | "raw";

export const WorkflowOutputViewer: React.FC<WorkflowOutputViewerProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  content,
}) => {
  const { t } = useLingui();
  const [mode, setMode] = useState<ViewMode>("tree");
  const [isAllOpen, setIsAllOpen] = useState(false);
  const raw = content.kind === "json" ? content.raw : content.text;
  const isTree = content.kind === "json" && mode === "tree";

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title={title} maxWidth="2xl">
      <div className="flex flex-col gap-3 p-4 min-h-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {subtitle && (
            <span className="row-meta w-full sm:w-auto sm:flex-1 min-w-0 truncate">
              {subtitle}
            </span>
          )}
          {content.kind === "json" && (
            <>
              <SegmentedControl<ViewMode>
                value={mode}
                onChange={setMode}
                segments={[
                  { value: "tree", label: <Trans>Tree</Trans> },
                  { value: "raw", label: <Trans>Raw</Trans> },
                ]}
              />
              {isTree && (
                <button
                  type="button"
                  className="chip-action"
                  onClick={() => setIsAllOpen(!isAllOpen)}
                >
                  {isAllOpen ? (
                    <Trans>Fold all</Trans>
                  ) : (
                    <Trans>Expand all</Trans>
                  )}
                </button>
              )}
            </>
          )}
          <CopyButton getText={() => raw} label={t`Copy output`} />
        </div>
        <div className="code-panel p-3 overflow-auto max-h-[60vh]">
          {isTree ? (
            <JsonTree
              key={isAllOpen ? "all" : "top"}
              value={content.value}
              openDepth={isAllOpen ? Number.POSITIVE_INFINITY : 2}
            />
          ) : content.kind === "json" || content.looksCut ? (
            <JsonText
              text={content.kind === "json" ? raw : indentPartialJson(raw)}
            />
          ) : (
            <pre className="m-0 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-discord-text-normal">
              {raw}
            </pre>
          )}
        </div>
      </div>
    </BaseModal>
  );
};

export default WorkflowOutputViewer;
