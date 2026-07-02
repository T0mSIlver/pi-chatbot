"use client";

import { PanelRightOpenIcon } from "lucide-react";
import {
  FilePathText,
  TOOL_ICON_CLASS,
  ToolErrorBody,
  type ToolRendererProps,
  ToolRow,
  ToolSubject,
} from "@/components/chat/tool-renderers/shared";
import { Button } from "@/components/ui/button";
import { getToolArgs } from "@/lib/tool-streaming";

export function ShowcaseToolRow({ part }: ToolRendererProps) {
  const { args, streaming } = getToolArgs(part);
  const running =
    part.state === "input-streaming" || part.state === "input-available";
  const isError = part.state === "output-error";
  const settled = part.state === "output-available";

  const path = typeof args.path === "string" ? args.path : undefined;

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
    settled && part.displayIntent ? (
      <Button
        className="h-6 px-2.5 text-[11.5px]"
        data-testid="workspace-open-preview"
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent("workspace-display", { detail: part.displayIntent })
          )
        }
        size="sm"
        type="button"
        variant="secondary"
      >
        Open preview
      </Button>
    ) : undefined;

  return (
    <ToolRow
      autoOpen={isError}
      error={isError}
      icon={<PanelRightOpenIcon className={TOOL_ICON_CLASS} />}
      meta={meta}
      running={running}
      subject={subject}
      verb="Showcase"
    >
      {isError ? (
        <ToolErrorBody message={part.errorText ?? "Tool failed"} />
      ) : undefined}
    </ToolRow>
  );
}
