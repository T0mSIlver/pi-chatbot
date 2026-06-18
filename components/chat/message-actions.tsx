import { GitBranchIcon, PencilIcon, RefreshCwIcon } from "lucide-react";
import { memo } from "react";
import { toast } from "sonner";
import { useActiveChat } from "@/hooks/use-active-chat";
import type { ChatMessage } from "@/lib/types";
import {
  MessageAction as Action,
  MessageActions as Actions,
} from "../ai-elements/message";
import { CopyIcon } from "./icons";

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the selection-based copy path below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Clipboard copy command was rejected");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

export function PureMessageActions({
  message,
  isLoading,
}: {
  chatId: string;
  message: ChatMessage;
  isLoading: boolean;
}) {
  const { startEditMessage, regenerateMessage, branchMessage } =
    useActiveChat();

  const textFromParts = message.parts
    ?.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  if (isLoading) {
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
    <Actions className="-ml-0.5 opacity-0 transition-opacity duration-150 group-hover/message:opacity-100">
      {textFromParts && (
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
      {message.role === "assistant" && (
        <Action
          className="text-muted-foreground/50 hover:text-foreground"
          onClick={() => regenerateMessage(message.id)}
          tooltip="Regenerate"
        >
          <RefreshCwIcon className="size-3.5" />
        </Action>
      )}
      {(message.role === "user" || message.role === "assistant") && (
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
    prevProps.message === nextProps.message
);
