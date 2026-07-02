"use client";

import { PlugIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  ArgsGrid,
  CappedPane,
  TOOL_ICON_CLASS,
  ToolErrorBody,
  type ToolRendererProps,
  ToolRow,
  ToolSubject,
} from "@/components/chat/tool-renderers/shared";
import {
  countLines,
  getMcpIdentity,
  getToolArgs,
  normalizeToolOutput,
} from "@/lib/tool-streaming";

function firstArgSummary(args: Record<string, unknown>): string | undefined {
  for (const value of Object.values(args)) {
    if (typeof value === "string" && value.length > 0) {
      return value.length > 48 ? `${value.slice(0, 48)}…` : value;
    }
  }
  return undefined;
}

export function McpToolRow({ part }: ToolRendererProps) {
  const { args, streaming } = getToolArgs(part);
  const output = normalizeToolOutput(part.output);
  const running =
    part.state === "input-streaming" || part.state === "input-available";
  const settled = part.state === "output-available";
  // pi-mcp-adapter reports many failures as a successful result carrying
  // details.error, not as state "output-error" — treat both as failed.
  const detailsError = output.details?.error;
  const isError =
    part.state === "output-error" ||
    (settled &&
      detailsError !== undefined &&
      detailsError !== null &&
      detailsError !== false);

  const identity = getMcpIdentity(part.toolName, output);
  const summary = streaming ? undefined : firstArgSummary(args);

  const subject = (
    <>
      {identity.server && (
        <span className="shrink-0 rounded-[5px] bg-muted px-1.5 py-px font-mono font-semibold text-[10.5px] text-secondary-foreground">
          {identity.server}
        </span>
      )}
      <ToolSubject text={identity.tool} />
      {summary && (
        <span className="min-w-0 truncate text-[12px] text-muted-foreground/80">
          {summary}
        </span>
      )}
    </>
  );

  const hasArgs = Object.keys(args).length > 0;

  let resultBody: ReactNode;
  if (isError) {
    const errorDetail =
      typeof detailsError === "string"
        ? detailsError
        : detailsError !== undefined && detailsError !== null
          ? JSON.stringify(detailsError, null, 2)
          : undefined;
    resultBody = (
      <ToolErrorBody
        hint={
          errorDetail && output.text && errorDetail !== output.text
            ? errorDetail
            : undefined
        }
        message={output.text ?? part.errorText ?? errorDetail ?? "Tool failed"}
      />
    );
  } else if (settled) {
    if (output.text) {
      resultBody = (
        <CappedPane
          expandLabel="Show full output"
          lineCount={countLines(output.text)}
        >
          <pre className="overflow-x-auto whitespace-pre-wrap break-words px-3.5 py-2.5 font-mono text-muted-foreground text-xs leading-relaxed">
            {output.text}
          </pre>
        </CappedPane>
      );
    } else if (output.details) {
      const json = JSON.stringify(output.details, null, 2);
      resultBody = (
        <CappedPane expandLabel="Show full output" lineCount={countLines(json)}>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words px-3.5 py-2.5 font-mono text-muted-foreground text-xs leading-relaxed">
            {json}
          </pre>
        </CappedPane>
      );
    }
  }

  const body =
    hasArgs || resultBody ? (
      <>
        {hasArgs && <ArgsGrid args={args} streaming={streaming} />}
        {resultBody && (
          <div className={hasArgs ? "border-t" : undefined}>{resultBody}</div>
        )}
      </>
    ) : undefined;

  return (
    <ToolRow
      autoOpen={running || isError}
      error={isError}
      icon={<PlugIcon className={TOOL_ICON_CLASS} />}
      running={running}
      subject={subject}
    >
      {body}
    </ToolRow>
  );
}
