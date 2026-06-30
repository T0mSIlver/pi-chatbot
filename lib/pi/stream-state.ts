import type { PiStreamEvent } from "@/lib/pi/events";
import type { ChatMessage, ChatMessagePart, PiToolUIPart } from "@/lib/types";

function mergeTextDelta(message: ChatMessage, delta: string) {
  const lastPart = message.parts.at(-1);
  if (lastPart?.type === "text") {
    lastPart.text += delta;
  } else {
    message.parts.push({ type: "text", text: delta });
  }
}

function mergeThinkingDelta(message: ChatMessage, delta: string) {
  const lastPart = message.parts.at(-1);
  if (lastPart?.type === "reasoning") {
    lastPart.text += delta;
    lastPart.state = "streaming";
  } else {
    message.parts.push({ type: "reasoning", text: delta, state: "streaming" });
  }
}

function finishActiveReasoning(message: ChatMessage) {
  const lastPart = message.parts.at(-1);
  if (lastPart?.type === "reasoning" && lastPart.state === "streaming") {
    lastPart.state = "done";
  }
}

function findToolPart(message: ChatMessage, toolCallId: string) {
  return message.parts.find(
    (part): part is PiToolUIPart =>
      part.type === "tool-pi" && part.toolCallId === toolCallId
  );
}

export function applyPiStreamEventToMessages({
  assistantMessageId,
  event,
  messages,
}: {
  assistantMessageId: string;
  event: PiStreamEvent;
  messages: ChatMessage[];
}): ChatMessage[] {
  if (event.type === "snapshot") {
    return event.messages;
  }

  if (event.type === "done" && event.messages) {
    return event.messages;
  }

  if (event.type === "stopped") {
    return messages.map((message) => ({
      ...message,
      parts: message.parts.map(
        (part): ChatMessagePart =>
          part.type === "reasoning" ? { ...part, state: "done" } : part
      ),
    }));
  }

  return messages.map((message) => {
    if (message.id !== assistantMessageId || message.role !== "assistant") {
      return message;
    }

    const next: ChatMessage = {
      ...message,
      parts: message.parts.map((part) => ({ ...part })),
    };

    if (event.type === "text-delta") {
      finishActiveReasoning(next);
      mergeTextDelta(next, event.delta);
    }

    if (event.type === "thinking-delta") {
      mergeThinkingDelta(next, event.delta);
    }

    if (event.type === "tool-input-start") {
      finishActiveReasoning(next);
      const toolPart = findToolPart(next, event.toolCallId);
      if (toolPart) {
        toolPart.state = "input-streaming";
        toolPart.toolName = event.toolName;
        toolPart.inputText = event.inputText ?? "";
      } else {
        next.parts.push({
          type: "tool-pi",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          state: "input-streaming",
          inputText: event.inputText ?? "",
        });
      }
    }

    if (event.type === "tool-input-delta") {
      finishActiveReasoning(next);
      const toolPart = findToolPart(next, event.toolCallId);
      if (toolPart) {
        toolPart.state = "input-streaming";
        toolPart.toolName = event.toolName;
        toolPart.inputText = event.inputText;
      } else {
        next.parts.push({
          type: "tool-pi",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          state: "input-streaming",
          inputText: event.inputText,
        });
      }
    }

    if (event.type === "tool-start") {
      finishActiveReasoning(next);
      const toolPart = findToolPart(next, event.toolCallId);
      if (toolPart) {
        toolPart.state = "input-available";
        toolPart.toolName = event.toolName;
        toolPart.input = event.input;
        toolPart.inputText = undefined;
      } else {
        next.parts.push({
          type: "tool-pi",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          state: "input-available",
          input: event.input,
        });
      }
    }

    if (event.type === "tool-update") {
      finishActiveReasoning(next);
      const toolPart = findToolPart(next, event.toolCallId);
      if (toolPart) {
        toolPart.output = event.output;
      }
    }

    if (event.type === "tool-end") {
      finishActiveReasoning(next);
      const toolPart = findToolPart(next, event.toolCallId);
      if (toolPart) {
        toolPart.state = event.isError ? "output-error" : "output-available";
        toolPart.output = event.output;
        toolPart.displayIntent = event.displayIntent;
        toolPart.errorText = event.errorText;
        toolPart.isError = event.isError;
      } else {
        next.parts.push({
          type: "tool-pi",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          state: event.isError ? "output-error" : "output-available",
          output: event.output,
          displayIntent: event.displayIntent,
          errorText: event.errorText,
          isError: event.isError,
        });
      }
    }

    if (event.type === "error") {
      finishActiveReasoning(next);
      mergeTextDelta(next, event.message);
    }

    if (event.type === "done") {
      next.parts = next.parts.map((part) =>
        part.type === "reasoning" ? { ...part, state: "done" } : part
      );
    }

    return next;
  });
}
