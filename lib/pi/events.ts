import type { PiToolUIPart, WorkspaceDisplayIntent } from "@/lib/types";

export type PiStreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "thinking-delta"; delta: string }
  | {
      type: "tool-input-start";
      toolCallId: string;
      toolName: string;
      inputText?: string;
    }
  | {
      type: "tool-input-delta";
      toolCallId: string;
      toolName: string;
      inputText: string;
    }
  | {
      type: "tool-start";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }
  | {
      type: "tool-update";
      toolCallId: string;
      toolName: string;
      output: unknown;
    }
  | {
      type: "tool-end";
      toolCallId: string;
      toolName: string;
      output: unknown;
      displayIntent?: WorkspaceDisplayIntent;
      errorText?: string;
      isError: boolean;
    }
  | { type: "workspace-display"; intent: WorkspaceDisplayIntent }
  | { type: "title"; title: string }
  | { type: "done"; sessionFilePath?: string }
  | { type: "error"; message: string };

export function toolEventToPart(
  event: Extract<PiStreamEvent, { type: "tool-start" | "tool-end" }>
): PiToolUIPart {
  if (event.type === "tool-start") {
    return {
      type: "tool-pi",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      state: "input-available",
      input: event.input,
    };
  }

  return {
    type: "tool-pi",
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    state: event.isError ? "output-error" : "output-available",
    output: event.output,
    displayIntent: event.displayIntent,
    errorText: event.errorText,
    isError: event.isError,
  };
}
