import type { ChatMessage, ChatMessagePart } from "@/lib/types";

function isMeaningfulPart(part: ChatMessagePart) {
  if (part.type === "text" || part.type === "reasoning") {
    return part.text.trim().length > 0;
  }

  return part.type === "tool-pi" || part.type === "file";
}

export function endsWithAssistantText(message: ChatMessage) {
  if (message.role !== "assistant") {
    return false;
  }

  const lastMeaningfulPart = message.parts.findLast(isMeaningfulPart);
  return (
    lastMeaningfulPart?.type === "text" &&
    lastMeaningfulPart.text.trim().length > 0
  );
}

export function isFinalAssistantAnswer(
  messages: ChatMessage[],
  messageIndex: number
) {
  const message = messages[messageIndex];
  if (!message || !endsWithAssistantText(message)) {
    return false;
  }

  for (let index = messageIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index];
    if (candidate.role === "user") {
      break;
    }
    if (candidate.role === "assistant") {
      return false;
    }
  }

  return true;
}
