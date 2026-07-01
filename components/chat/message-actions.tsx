import { GitBranchIcon, PencilIcon, RefreshCwIcon } from "lucide-react";
import { memo } from "react";
import { toast } from "sonner";
import { useActiveChat } from "@/hooks/use-active-chat";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { ChatMessage } from "@/lib/types";
import {
  MessageAction as Action,
  MessageActions as Actions,
} from "../ai-elements/message";
import { CopyIcon } from "./icons";

export function PureMessageActions({
  message,
  isLoading,
  isFinalAssistantAnswer,
}: {
  chatId: string;
  message: ChatMessage;
  isLoading: boolean;
  isFinalAssistantAnswer: boolean;
}) {
  const { startEditMessage, regenerateMessage, branchMessage } =
    useActiveChat();

  const textFromParts = message.parts
    ?.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  if (isLoading || (message.role === "assistant" && !isFinalAssistantAnswer)) {
    return null;
  }

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(textFromParts);
      toast.success("Copied to clipboard!");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <Actions
      className="-ml-0.5 message-actions-hover-reveal opacity-100 transition-opacity duration-150 focus-within:opacity-100"
      data-testid="message-actions"
    >
      {textFromParts && message.role !== "system" && (
        <Action
          className="text-muted-foreground/50 hover:text-foreground"
          onClick={handleCopy}
          tooltip="Copy"
        >
          <CopyIcon />
        </Action>
      )}
      {message.role === "user" && textFromParts && (
        <Action
          className="text-muted-foreground/50 hover:text-foreground"
          onClick={() => startEditMessage(message.id)}
          tooltip="Edit"
        >
          <PencilIcon className="size-3.5" />
        </Action>
      )}
      {message.role === "assistant" && isFinalAssistantAnswer && (
        <Action
          className="text-muted-foreground/50 hover:text-foreground"
          onClick={() => regenerateMessage(message.id)}
          tooltip="Regenerate"
        >
          <RefreshCwIcon className="size-3.5" />
        </Action>
      )}
      {message.role === "assistant" && isFinalAssistantAnswer && (
        <Action
          className="text-muted-foreground/50 hover:text-foreground"
          onClick={() => branchMessage(message.id)}
          tooltip="Branch"
        >
          <GitBranchIcon className="size-3.5" />
        </Action>
      )}
    </Actions>
  );
}

export const MessageActions = memo(
  PureMessageActions,
  (prevProps, nextProps) =>
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.isFinalAssistantAnswer === nextProps.isFinalAssistantAnswer &&
    prevProps.message === nextProps.message
);
