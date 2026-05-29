"use client";

import { useEffect, useRef, useState } from "react";
import { useActiveChat } from "@/hooks/use-active-chat";
import type { Attachment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChatHeader } from "./chat-header";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";

export function ChatShell() {
  const {
    chatId,
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    input,
    setInput,
    isReadonly,
    isLoading,
    currentModelId,
    setCurrentModelId,
  } = useActiveChat();

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      stopRef.current();
      setAttachments([]);
    }
  }, [chatId]);

  return (
    <div className="flex h-dvh w-full flex-row overflow-hidden">
      <div className={cn("flex min-w-0 flex-col bg-sidebar w-full")}>
        <ChatHeader chatId={chatId} isReadonly={isReadonly} />

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:rounded-tl-[12px] md:border-t md:border-l md:border-border/40">
          <Messages
            chatId={chatId}
            isArtifactVisible={false}
            isLoading={isLoading}
            isReadonly={isReadonly}
            messages={messages}
            selectedModelId={currentModelId}
            setMessages={setMessages}
            status={status}
          />

          <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
            {!isReadonly && (
              <MultimodalInput
                attachments={attachments}
                chatId={chatId}
                input={input}
                isLoading={isLoading}
                messages={messages}
                onModelChange={setCurrentModelId}
                selectedModelId={currentModelId}
                sendMessage={sendMessage}
                setAttachments={setAttachments}
                setInput={setInput}
                setMessages={setMessages}
                status={status}
                stop={stop}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
