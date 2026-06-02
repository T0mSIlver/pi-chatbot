"use client";

import { useEffect, useRef, useState } from "react";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Attachment, WorkspaceDisplayIntent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent } from "../ui/sheet";
import { ChatHeader } from "./chat-header";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { WorkspaceWorkbench } from "./workspace-workbench";

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
    latestWorkspaceDisplayIntent,
  } = useActiveChat();

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isWorkbenchOpen, setIsWorkbenchOpen] = useState(false);
  const [selectedWorkspaceIntent, setSelectedWorkspaceIntent] =
    useState<WorkspaceDisplayIntent | null>(null);
  const isMobile = useIsMobile();
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      stopRef.current();
      setAttachments([]);
      setIsWorkbenchOpen(false);
      setSelectedWorkspaceIntent(null);
    }
  }, [chatId]);

  useEffect(() => {
    if (
      latestWorkspaceDisplayIntent &&
      latestWorkspaceDisplayIntent.chatId === chatId
    ) {
      setSelectedWorkspaceIntent(latestWorkspaceDisplayIntent);
      setIsWorkbenchOpen(true);
    }
  }, [chatId, latestWorkspaceDisplayIntent]);

  useEffect(() => {
    const handleWorkspaceDisplay = (event: Event) => {
      const intent = (event as CustomEvent<WorkspaceDisplayIntent>).detail;
      if (intent?.type === "workspace-file" && intent.chatId === chatId) {
        setSelectedWorkspaceIntent(intent);
        setIsWorkbenchOpen(true);
      }
    };

    window.addEventListener("workspace-display", handleWorkspaceDisplay);
    return () => {
      window.removeEventListener("workspace-display", handleWorkspaceDisplay);
    };
  }, [chatId]);

  const workbench = (
    <WorkspaceWorkbench
      chatId={chatId}
      className={isMobile ? "h-full w-full border-l-0" : "w-[min(48vw,720px)]"}
      onClose={() => setIsWorkbenchOpen(false)}
      onSelectIntent={setSelectedWorkspaceIntent}
      open={isWorkbenchOpen}
      selectedIntent={selectedWorkspaceIntent}
      status={status}
    />
  );

  return (
    <div className="flex h-dvh w-full flex-row overflow-hidden">
      <div className={cn("flex min-w-0 flex-1 flex-col bg-sidebar")}>
        <ChatHeader
          chatId={chatId}
          isReadonly={isReadonly}
          isWorkbenchOpen={isWorkbenchOpen}
          onToggleWorkbench={() =>
            setIsWorkbenchOpen((currentOpen) => !currentOpen)
          }
        />

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
      {!isMobile && isWorkbenchOpen && workbench}
      {isMobile && (
        <Sheet onOpenChange={setIsWorkbenchOpen} open={isWorkbenchOpen}>
          <SheetContent
            className="w-[92vw] p-0 sm:max-w-[92vw]"
            showCloseButton={false}
          >
            {workbench}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
