"use client";

import { TerminalIcon } from "lucide-react";
import {
  commandSummary,
  countLines,
  formatDuration,
  getToolArgs,
  isPlainRecord,
  normalizeToolOutput,
} from "@/lib/tool-streaming";
import { cn } from "@/lib/utils";
import {
  CappedPane,
  TOOL_ICON_CLASS,
  ToolChip,
  type ToolRendererProps,
  ToolRow,
  ToolSubject,
  useElapsedMs,
} from "./shared";

function getTruncationNote(details: Record<string, unknown> | undefined) {
  const truncation = details?.truncation;
  if (!isPlainRecord(truncation) || truncation.truncated !== true) {
    return undefined;
  }
  const shown = truncation.outputLines;
  const total = truncation.totalLines;
  if (typeof shown === "number" && typeof total === "number") {
    return `showing last ${shown} of ${total} lines`;
  }
  return "output truncated";
}

export function BashToolRow({ part }: ToolRendererProps) {
  const { args, streaming } = getToolArgs(part);
  const output = normalizeToolOutput(part.output);
  const running =
    part.state === "input-streaming" || part.state === "input-available";
  const isError = part.state === "output-error";

  const command = typeof args.command === "string" ? args.command : undefined;
  const outputText = output.text ?? (isError ? part.errorText : undefined);
  const truncationNote = getTruncationNote(output.details);
  const elapsedMs = useElapsedMs(running);

  const outputLineCount = outputText ? countLines(outputText) : 0;

  return (
    <ToolRow
      autoOpen={running || isError}
      error={isError}
      icon={<TerminalIcon className={TOOL_ICON_CLASS} />}
      meta={
        <>
          {isError && (
            <span className="font-semibold text-destructive">failed</span>
          )}
          {truncationNote && <ToolChip>truncated</ToolChip>}
          {elapsedMs !== null && <span>{formatDuration(elapsedMs)}</span>}
        </>
      }
      running={running}
      subject={
        <ToolSubject
          shimmer={streaming}
          text={command ? commandSummary(command) : "…"}
        />
      }
      verb="Run"
    >
      {command !== undefined || outputText ? (
        <CappedPane
          expandLabel="Show full output"
          fadeToClass="to-[var(--tool-term-bg)]"
          follow={running}
          lineCount={outputLineCount + (command ? countLines(command) : 0)}
          maxHeight={280}
        >
          <div className="overflow-x-auto bg-[var(--tool-term-bg)] px-3.5 py-3 font-mono text-[var(--tool-term-fg)] text-xs leading-relaxed">
            {command !== undefined && (
              <div className="whitespace-pre-wrap break-words">
                <span className="select-none text-[var(--tool-term-muted)]">
                  ${" "}
                </span>
                <span className="font-medium">{command}</span>
              </div>
            )}
            {outputText && (
              <div
                className={cn(
                  "whitespace-pre-wrap break-words",
                  isError
                    ? "text-[var(--tool-term-err)]"
                    : "text-[var(--tool-term-muted)]"
                )}
              >
                {outputText}
              </div>
            )}
            {running && (
              <span className="inline-block h-3 w-[7px] animate-pulse bg-[var(--tool-term-fg)] align-middle" />
            )}
            {truncationNote && !running && (
              <div className="mt-1 text-[11px] text-[var(--tool-term-muted)] opacity-80">
                {truncationNote} — full log on the server
              </div>
            )}
          </div>
        </CappedPane>
      ) : undefined}
    </ToolRow>
  );
}
