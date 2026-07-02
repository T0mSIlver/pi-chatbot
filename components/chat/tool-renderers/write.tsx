"use client";

import { FilePlus2Icon } from "lucide-react";
import {
  CappedPane,
  CodePane,
  FilePathText,
  TOOL_ICON_CLASS,
  ToolErrorBody,
  type ToolRendererProps,
  ToolRow,
  ToolSubject,
} from "@/components/chat/tool-renderers/shared";
import { countLines, formatBytes, getToolArgs } from "@/lib/tool-streaming";

export function WriteToolRow({ part }: ToolRendererProps) {
  const { args, streaming } = getToolArgs(part);
  const running =
    part.state === "input-streaming" || part.state === "input-available";
  const isError = part.state === "output-error";
  const settled = part.state === "output-available";

  const path = typeof args.path === "string" ? args.path : undefined;
  const content = typeof args.content === "string" ? args.content : undefined;

  const subject =
    path === undefined ? (
      <ToolSubject shimmer text="…" />
    ) : streaming ? (
      <ToolSubject shimmer text={path} />
    ) : (
      <ToolSubject>
        <FilePathText path={path} />
      </ToolSubject>
    );

  const meta =
    content !== undefined ? (
      <>
        <span className="font-mono font-semibold text-[11px] text-[var(--tool-add-fg)] tabular-nums">
          +{countLines(content)} lines
        </span>
        {settled && <span>{formatBytes(content.length)}</span>}
      </>
    ) : undefined;

  return (
    <ToolRow
      autoOpen={streaming || running || isError}
      error={isError}
      icon={<FilePlus2Icon className={TOOL_ICON_CLASS} />}
      meta={meta}
      running={running}
      subject={subject}
      verb="Write"
    >
      {isError ? (
        <ToolErrorBody message={part.errorText ?? "Tool failed"} />
      ) : content !== undefined ? (
        <div className="border-l-2 border-[var(--tool-add-fg)]">
          <CappedPane
            expandLabel="Show all"
            follow={streaming}
            lineCount={countLines(content)}
            maxHeight={280}
          >
            <CodePane startLine={1} text={content} />
          </CappedPane>
        </div>
      ) : undefined}
    </ToolRow>
  );
}
