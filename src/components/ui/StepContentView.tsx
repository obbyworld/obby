import type React from "react";
import { indentPartialJson, type StepContent } from "../../lib/workflowFormat";
import JsonTree, { JsonText } from "./JsonTree";

export const StepContentView: React.FC<{ content: StepContent }> = ({
  content,
}) => {
  if (content.kind === "json") return <JsonTree value={content.value} />;
  if (content.looksCut)
    return <JsonText text={indentPartialJson(content.text)} />;
  return <pre className="code-text">{content.text}</pre>;
};

export default StepContentView;
