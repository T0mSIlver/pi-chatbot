"use client";

import { FileTextIcon } from "lucide-react";
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
import {
  countLines,
  formatLineRange,
  getToolArgs,
  normalizeToolOutput,
} from "@/lib/tool-streaming";

export function ReadToolRow({ part }: ToolRendererProps) {
  const { args, streaming } = getToolArgs(part);
  const output = normalizeToolOutput(part.output);
  const running =
    part.state === "input-streaming" || part.state === "input-available";
  const isError = part.state === "output-error";
  const settled = part.state === "output-available";

  const path = typeof args.path === "string" ? args.path : undefined;
  const range = formatLineRange(args.offset, args.limit);

  const subject =
    path === undefined ? (
      <ToolSubject shimmer text="…" />
    ) : streaming ? (
      <ToolSubject shimmer text={path + (range ?? "")} />
    ) : (
      <ToolSubject>
        <FilePathText path={path} range={range} />
      </ToolSubject>
    );

  const hasText =
    settled && typeof output.text === "string" && output.text.length > 0;
  const lineCount = hasText ? countLines(output.text as string) : 0;

  return (
    <ToolRow
      autoOpen={isError}
      error={isError}
      icon={<FileTextIcon className={TOOL_ICON_CLASS} />}
      meta={hasText ? `${lineCount} lines` : undefined}
      running={running}
      subject={subject}
      verb="Read"
    >
      {isError ? (
        <ToolErrorBody message={part.errorText ?? "Tool failed"} />
      ) : hasText ? (
        <CappedPane
          expandLabel={`Show all ${lineCount} lines`}
          lineCount={lineCount}
        >
          <CodePane
            startLine={typeof args.offset === "number" ? args.offset : 1}
            text={output.text as string}
          />
        </CappedPane>
      ) : undefined}
    </ToolRow>
  );
}
