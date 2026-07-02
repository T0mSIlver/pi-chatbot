"use client";

import { PencilLineIcon } from "lucide-react";
import { useMemo } from "react";
import type { DiffLine, ParsedDiff } from "@/lib/tool-streaming";
import {
  getEditReplacements,
  getEditResultDiff,
  getToolArgs,
  normalizeToolOutput,
  provisionalEditStats,
} from "@/lib/tool-streaming";
import {
  AddRemoveCounts,
  DiffView,
  FilePathText,
  TOOL_ICON_CLASS,
  ToolErrorBody,
  type ToolRendererProps,
  ToolRow,
  ToolSpinner,
  ToolSubject,
} from "./shared";

/**
 * Streamed oldText/newText blocks rendered as a diff before the edit has
 * applied: removals first, then additions, per replacement — matching the
 * order the argument text actually arrives in. No line numbers; those
 * only exist once the server returns the authoritative diff.
 */
function buildProvisionalDiff(
  edits: ReturnType<typeof getEditReplacements>
): ParsedDiff {
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;

  for (const [index, edit] of edits.entries()) {
    if (index > 0) {
      lines.push({ kind: "gap", text: "" });
    }
    if (edit.oldText !== undefined) {
      for (const text of edit.oldText.split("\n")) {
        lines.push({ kind: "del", text });
        removed += 1;
      }
    }
    if (edit.newText !== undefined) {
      for (const text of edit.newText.split("\n")) {
        lines.push({ kind: "add", text });
        added += 1;
      }
    }
  }

  return { lines, added, removed };
}

export function EditToolRow({ part }: ToolRendererProps) {
  const { args, streaming } = getToolArgs(part);
  const output = normalizeToolOutput(part.output);
  const running =
    part.state === "input-streaming" || part.state === "input-available";
  const isError = part.state === "output-error";
  const settled = part.state === "output-available";

  const path = typeof args.path === "string" ? args.path : undefined;
  const authoritative = settled ? getEditResultDiff(output) : undefined;

  const provisional = useMemo(() => {
    if (authoritative) {
      return undefined;
    }
    return buildProvisionalDiff(getEditReplacements(args));
  }, [args, authoritative]);

  const diff = authoritative ?? provisional;
  const counts =
    authoritative ?? provisionalEditStats(getEditReplacements(args));

  const subject = path ? (
    streaming ? (
      <ToolSubject shimmer text={path} />
    ) : (
      <ToolSubject>
        <FilePathText path={path} />
      </ToolSubject>
    )
  ) : (
    <ToolSubject shimmer={streaming} text="…" />
  );

  const showCounts = counts.added > 0 || counts.removed > 0;
  const hasDiff = diff !== undefined && diff.lines.length > 0;

  return (
    <ToolRow
      autoOpen={hasDiff || isError}
      error={isError}
      icon={<PencilLineIcon className={TOOL_ICON_CLASS} />}
      meta={
        isError ? (
          <span>failed</span>
        ) : showCounts ? (
          <AddRemoveCounts added={counts.added} removed={counts.removed} />
        ) : undefined
      }
      running={running}
      subject={subject}
      verb="Edit"
    >
      {isError ? (
        <ToolErrorBody message={part.errorText ?? "Edit failed"} />
      ) : hasDiff ? (
        <DiffView
          diff={diff}
          footer={
            streaming || running ? (
              <div className="flex items-center gap-1.5 border-border border-t border-dashed px-3.5 py-1 text-[11px] text-muted-foreground">
                <ToolSpinner className="size-2.5" />
                Provisional — replaced by the applied diff on completion
              </div>
            ) : undefined
          }
        />
      ) : undefined}
    </ToolRow>
  );
}
