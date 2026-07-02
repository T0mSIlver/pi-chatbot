"use client";

import type { ChatMessage, PiToolUIPart, SetMessages } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import { MessageContent, MessageResponse } from "../ai-elements/message";
import { Shimmer } from "../ai-elements/shimmer";
import { MessageActions } from "./message-actions";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";
import { ProviderStatsToggle } from "./provider-stats-toggle";
import { PiToolPart } from "./tool-renderers/registry";

const PurePreviewMessage = ({
  chatId,
  message,
  isLoading,
  isFinalAssistantAnswer,
  setMessages: _setMessages,
  isReadonly,
  requiresScrollPadding: _requiresScrollPadding,
}: {
  chatId: string;
  message: ChatMessage;
  isLoading: boolean;
  isFinalAssistantAnswer: boolean;
  setMessages: SetMessages;
  isReadonly: boolean;
  requiresScrollPadding: boolean;
}) => {
  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === "file"
  );

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  const hasAnyContent = message.parts?.some(
    (part) =>
      (part.type === "text" && part.text?.trim().length > 0) ||
      (part.type === "reasoning" && part.text?.trim().length > 0) ||
      part.type === "tool-pi"
  );
  const isThinking = isAssistant && isLoading && !hasAnyContent;

  const attachments = attachmentsFromMessage.length > 0 && (
    <div
      className="flex max-w-full flex-row justify-end gap-2 overflow-x-auto pb-1 no-scrollbar"
      data-testid={"message-attachments"}
    >
      {attachmentsFromMessage.map((attachment) => (
        <PreviewAttachment
          attachment={{
            name: attachment.filename ?? attachment.name ?? "file",
            contentType: attachment.mediaType,
            url: attachment.url,
          }}
          key={attachment.url}
        />
      ))}
    </div>
  );

  const parts = message.parts?.map((part, index) => {
    const key = `message-${message.id}-part-${index}`;

    if (part.type === "reasoning") {
      if (part.text?.trim().length > 0) {
        return (
          <MessageReasoning
            isLoading={isLoading && part.state === "streaming"}
            key={key}
            reasoning={part.text}
          />
        );
      }
      return null;
    }

    if (part.type === "text") {
      return (
        <MessageContent
          className={cn("text-[13px] leading-[1.65]", {
            "w-fit max-w-[min(90%,56ch)] overflow-hidden break-words rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 shadow-[var(--shadow-card)] md:max-w-[min(80%,56ch)]":
              message.role === "user",
          })}
          data-testid="message-content"
          key={key}
        >
          <MessageResponse>{sanitizeText(part.text)}</MessageResponse>
        </MessageContent>
      );
    }

    if (part.type === "tool-pi") {
      const toolPart = part as PiToolUIPart;
      return <PiToolPart key={toolPart.toolCallId} part={toolPart} />;
    }

    return null;
  });

  const actions = !isReadonly && (
    <MessageActions
      chatId={chatId}
      isFinalAssistantAnswer={isFinalAssistantAnswer}
      isLoading={isLoading}
      key={`action-${message.id}`}
      message={message}
    />
  );
  const stats = message.metadata?.providerStats;
  const isInterrupted = isAssistant && message.metadata?.interrupted === true;

  const content = isThinking ? (
    <div className="flex h-[calc(13px*1.65)] items-center text-[13px] leading-[1.65]">
      <Shimmer className="font-medium" duration={1}>
        Thinking...
      </Shimmer>
    </div>
  ) : (
    <>
      {attachments}
      {parts}
      {isInterrupted && (
        <div
          className="text-[12px] text-muted-foreground/80 italic"
          data-testid="message-interrupted"
        >
          Generation was interrupted — regenerate to continue.
        </div>
      )}
      {!isAssistant && actions}
    </>
  );

  return (
    <div
      className={cn(
        "group/message w-full",
        !isAssistant && "animate-[fade-up_0.25s_cubic-bezier(0.22,1,0.36,1)]"
      )}
      data-role={message.role}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn(
          isUser
            ? "flex min-w-0 flex-col items-end gap-2"
            : "flex min-w-0 flex-col items-start"
        )}
      >
        {isAssistant ? (
          <div className="flex w-full min-w-0 flex-col gap-2">
            {content}
            {/* Footer: token indicators and message actions share one line. */}
            {isFinalAssistantAnswer &&
              (stats !== undefined || (!isReadonly && !isLoading)) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {stats && <ProviderStatsToggle stats={stats} />}
                  {actions}
                </div>
              )}
          </div>
        ) : (
          content
        )}
      </div>
    </div>
  );
};

export const PreviewMessage = PurePreviewMessage;

export const ThinkingMessage = () => {
  return (
    <div
      className="group/message w-full"
      data-role="assistant"
      data-testid="message-assistant-loading"
    >
      <div className="flex min-w-0 flex-col items-start">
        <div className="flex h-[calc(13px*1.65)] items-center text-[13px] leading-[1.65]">
          <Shimmer className="font-medium" duration={1}>
            Thinking...
          </Shimmer>
        </div>
      </div>
    </div>
  );
};
