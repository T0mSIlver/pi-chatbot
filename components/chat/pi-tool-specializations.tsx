"use client";

import { PanelRightOpenIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { PiToolUIPart } from "@/lib/types";
import { Button } from "../ui/button";

type PiToolSpecializationContext = {
  toolPart: PiToolUIPart;
};

type PiToolSpecialization = {
  id: string;
  matches: (toolPart: PiToolUIPart) => boolean;
  renderAction?: (context: PiToolSpecializationContext) => ReactNode;
};

function openWorkspaceDisplay(toolPart: PiToolUIPart) {
  if (!toolPart.displayIntent) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("workspace-display", {
      detail: toolPart.displayIntent,
    })
  );
}

const showcaseFileSpecialization: PiToolSpecialization = {
  id: "showcase_file",
  matches: (toolPart) =>
    toolPart.toolName === "showcase_file" &&
    toolPart.state === "output-available" &&
    Boolean(toolPart.displayIntent),
  renderAction: ({ toolPart }) => (
    <Button
      className="w-fit"
      data-testid="workspace-open-preview"
      onClick={() => openWorkspaceDisplay(toolPart)}
      size="sm"
      type="button"
      variant="secondary"
    >
      <PanelRightOpenIcon className="size-4" />
      Open preview
    </Button>
  ),
};

const piToolSpecializations: PiToolSpecialization[] = [
  showcaseFileSpecialization,
];

export function getPiToolSpecialization(toolPart: PiToolUIPart) {
  return (
    piToolSpecializations.find((specialization) =>
      specialization.matches(toolPart)
    ) ?? null
  );
}

export function renderPiToolSpecializedAction(toolPart: PiToolUIPart) {
  return (
    getPiToolSpecialization(toolPart)?.renderAction?.({ toolPart }) ?? null
  );
}
