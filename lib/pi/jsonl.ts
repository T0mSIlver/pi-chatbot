import "server-only";

import { readFile } from "node:fs/promises";
import { formatISO } from "date-fns";
import type { ChatMessage, ChatMessagePart, PiToolUIPart } from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import {
  displayIntentFromShowcaseToolInput,
  displayIntentFromToolResult,
} from "./workspace-files";

type SessionMessageEntry = {
  type: "message";
  id: string;
  timestamp: string;
  message: {
    role: string;
    content?: unknown;
    toolCallId?: string;
    toolName?: string;
    details?: unknown;
    isError?: boolean;
    errorMessage?: string;
  };
};

function isSessionMessageEntry(value: unknown): value is SessionMessageEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: string }).type === "message" &&
    typeof (value as { message?: unknown }).message === "object"
  );
}

function contentToText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter(
      (block): block is { type: string; text?: string } =>
        typeof block === "object" && block !== null && "type" in block
    )
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

function createdAt(timestamp: string | undefined) {
  const date = timestamp ? new Date(timestamp) : new Date();
  return Number.isNaN(date.getTime()) ? formatISO(new Date()) : formatISO(date);
}

function findToolPart(messages: ChatMessage[], toolCallId: string) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "assistant") {
      continue;
    }
    const part = message.parts.find(
      (candidate): candidate is PiToolUIPart =>
        candidate.type === "tool-pi" && candidate.toolCallId === toolCallId
    );
    if (part) {
      return part;
    }
  }
  return null;
}

function getOrCreateAssistantForTool(
  messages: ChatMessage[],
  entry: SessionMessageEntry
) {
  const lastAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");

  if (lastAssistant) {
    return lastAssistant;
  }

  const assistant: ChatMessage = {
    id: entry.id || generateUUID(),
    role: "assistant",
    parts: [],
    metadata: { createdAt: createdAt(entry.timestamp) },
  };
  messages.push(assistant);
  return assistant;
}

function convertEntry(
  entry: SessionMessageEntry,
  messages: ChatMessage[],
  chatId?: string | null
) {
  const { message } = entry;

  if (message.role === "user") {
    messages.push({
      id: entry.id || generateUUID(),
      role: "user",
      parts: [{ type: "text", text: contentToText(message.content) }],
      metadata: { createdAt: createdAt(entry.timestamp) },
    });
    return;
  }

  if (message.role === "assistant") {
    const parts: ChatMessagePart[] = [];
    const content = Array.isArray(message.content) ? message.content : [];

    for (const block of content) {
      if (typeof block !== "object" || block === null || !("type" in block)) {
        continue;
      }

      if (
        block.type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        parts.push({
          type: "text",
          text: String((block as { text: string }).text),
        });
      }

      if (
        block.type === "thinking" &&
        typeof (block as { thinking?: unknown }).thinking === "string"
      ) {
        parts.push({
          type: "reasoning",
          text: String((block as { thinking: string }).thinking),
          state: "done",
        });
      }

      if (
        block.type === "toolCall" &&
        typeof (block as { id?: unknown }).id === "string"
      ) {
        const toolCall = block as {
          id: string;
          name?: string;
          arguments?: unknown;
        };
        const displayIntent =
          toolCall.name === "showcase_file"
            ? displayIntentFromShowcaseToolInput({
                value: toolCall.arguments,
                chatId,
              })
            : null;
        parts.push({
          type: "tool-pi",
          toolCallId: toolCall.id,
          toolName: toolCall.name ?? "tool",
          state: "input-available",
          input: toolCall.arguments,
          displayIntent: displayIntent ?? undefined,
        });
      }
    }

    if (message.errorMessage) {
      parts.push({ type: "text", text: message.errorMessage });
    }

    if (parts.length > 0) {
      messages.push({
        id: entry.id || generateUUID(),
        role: "assistant",
        parts,
        metadata: { createdAt: createdAt(entry.timestamp) },
      });
    }
    return;
  }

  if (message.role === "toolResult" && message.toolCallId) {
    const toolPart =
      findToolPart(messages, message.toolCallId) ??
      (() => {
        const assistant = getOrCreateAssistantForTool(messages, entry);
        const createdPart: PiToolUIPart = {
          type: "tool-pi",
          toolCallId: message.toolCallId ?? generateUUID(),
          toolName: message.toolName ?? "tool",
          state: "input-available",
        };
        assistant.parts.push(createdPart);
        return createdPart;
      })();

    const text = contentToText(message.content);
    const displayIntent =
      displayIntentFromToolResult(message.details) ??
      (toolPart.toolName === "showcase_file"
        ? displayIntentFromShowcaseToolInput({
            value: toolPart.input,
            chatId,
          })
        : null) ??
      toolPart.displayIntent ??
      null;
    toolPart.state = message.isError ? "output-error" : "output-available";
    toolPart.output = displayIntent
      ? text || "Opened in the preview pane."
      : (message.details ?? text);
    toolPart.displayIntent = displayIntent ?? undefined;
    toolPart.errorText = message.isError ? text || "Tool failed" : undefined;
    toolPart.isError = message.isError;
  }
}

export function piEntriesToChatMessages(
  entries: unknown[],
  chatId?: string | null
) {
  const messages: ChatMessage[] = [];

  for (const entry of entries) {
    if (isSessionMessageEntry(entry)) {
      convertEntry(entry, messages, chatId);
    }
  }

  return messages;
}

export async function readPiSessionMessages(
  sessionFilePath: string | null,
  chatId?: string | null
) {
  if (!sessionFilePath) {
    return [];
  }

  try {
    const content = await readFile(sessionFilePath, "utf8");
    const entries = content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return piEntriesToChatMessages(entries, chatId);
  } catch {
    return [];
  }
}
