"use client";

import { SearchIcon } from "lucide-react";
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

export function GrepToolRow({ part }: ToolRendererProps) {
  const { args, streaming } = getToolArgs(part);
  const output = normalizeToolOutput(part.output);
  const running =
    part.state === "input-streaming" || part.state === "input-available";
  const isError = part.state === "output-error";
  const settled = part.state === "output-available";

  const pattern = typeof args.pattern === "string" ? args.pattern : undefined;
  const location =
    typeof args.path === "string"
      ? args.path
      : typeof args.glob === "string"
        ? args.glob
        : undefined;

  const subjectText =
    pattern !== undefined ? pattern + (location ? ` in ${location}` : "") : "…";

  const subject = streaming ? (
    <ToolSubject shimmer text={subjectText} />
  ) : (
    <ToolSubject>
      {pattern}
      {location && <span className="opacity-70"> in {location}</span>}
    </ToolSubject>
  );

  const noMatches = settled && output.text === "No matches found";
  const hasMatches =
    settled &&
    typeof output.text === "string" &&
    output.text.length > 0 &&
    !noMatches;
  const lineCount = hasMatches ? countLines(output.text as string) : 0;

  const meta = noMatches
    ? "no matches"
    : hasMatches
      ? `${lineCount} matches`
      : undefined;

  return (
    <ToolRow
      autoOpen={isError}
      error={isError}
      icon={<SearchIcon className={TOOL_ICON_CLASS} />}
      meta={meta}
      running={running}
      subject={subject}
      verb="Search"
    >
      {isError ? (
        <ToolErrorBody message={part.errorText ?? "Tool failed"} />
      ) : hasMatches ? (
        <CappedPane expandLabel="Show all matches" lineCount={lineCount}>
          <CodePane text={output.text as string} />
        </CappedPane>
      ) : undefined}
    </ToolRow>
  );
}
