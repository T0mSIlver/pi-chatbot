"use client";

import { FileSearchIcon, FolderIcon } from "lucide-react";
import {
  CappedPane,
  CodePane,
  TOOL_ICON_CLASS,
  ToolErrorBody,
  type ToolRendererProps,
  ToolRow,
  ToolSubject,
} from "@/components/chat/tool-renderers/shared";
import {
  countLines,
  getToolArgs,
  normalizeToolOutput,
} from "@/lib/tool-streaming";

export function LsToolRow({ part }: ToolRendererProps) {
  const { args, streaming } = getToolArgs(part);
  const output = normalizeToolOutput(part.output);
  const running =
    part.state === "input-streaming" || part.state === "input-available";
  const isError = part.state === "output-error";
  const settled = part.state === "output-available";

  const path = typeof args.path === "string" ? args.path : ".";

  const subject = streaming ? (
    <ToolSubject shimmer text={path} />
  ) : (
    <ToolSubject text={path} />
  );

  const hasText =
    settled && typeof output.text === "string" && output.text.length > 0;
  const lineCount = hasText ? countLines(output.text as string) : 0;

  return (
    <ToolRow
      autoOpen={isError}
      error={isError}
      icon={<FolderIcon className={TOOL_ICON_CLASS} />}
      meta={hasText ? `${lineCount} entries` : undefined}
      running={running}
      subject={subject}
      verb="List"
    >
      {isError ? (
        <ToolErrorBody message={part.errorText ?? "Tool failed"} />
      ) : hasText ? (
        <CappedPane expandLabel="Show all entries" lineCount={lineCount}>
          <CodePane text={output.text as string} />
        </CappedPane>
      ) : undefined}
    </ToolRow>
  );
}

export function FindToolRow({ part }: ToolRendererProps) {
  const { args, streaming } = getToolArgs(part);
  const output = normalizeToolOutput(part.output);
  const running =
    part.state === "input-streaming" || part.state === "input-available";
  const isError = part.state === "output-error";
  const settled = part.state === "output-available";

  const pattern = typeof args.pattern === "string" ? args.pattern : undefined;
  const path = typeof args.path === "string" ? args.path : undefined;

  const subjectText =
    pattern !== undefined ? pattern + (path ? ` in ${path}` : "") : "…";

  const subject = streaming ? (
    <ToolSubject shimmer text={subjectText} />
  ) : (
    <ToolSubject>
      {pattern}
      {path && <span className="opacity-70"> in {path}</span>}
    </ToolSubject>
  );

  const hasText =
    settled && typeof output.text === "string" && output.text.length > 0;
  const lineCount = hasText ? countLines(output.text as string) : 0;

  return (
    <ToolRow
      autoOpen={isError}
      error={isError}
      icon={<FileSearchIcon className={TOOL_ICON_CLASS} />}
      meta={hasText ? `${lineCount} results` : undefined}
      running={running}
      subject={subject}
      verb="Find"
    >
      {isError ? (
        <ToolErrorBody message={part.errorText ?? "Tool failed"} />
      ) : hasText ? (
        <CappedPane expandLabel="Show all results" lineCount={lineCount}>
          <CodePane text={output.text as string} />
        </CappedPane>
      ) : undefined}
    </ToolRow>
  );
}
