"use client";

import { useEffect, useRef, useState } from "react";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useIsMobile } from "@/hooks/use-mobile";
import type {
  Attachment,
  WorkspaceChange,
  WorkspaceDisplayIntent,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Sheet, SheetContent } from "../ui/sheet";
import { ChatHeader } from "./chat-header";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { WorkspaceWorkbench } from "./workspace-workbench";

type RestoreConfirmation = {
  changes: WorkspaceChange[];
  onCancel: () => void;
  onConfirm: () => void;
} | null;

const restoreChangeLabels: Record<WorkspaceChange["change"], string> = {
  created: "Create",
  deleted: "Delete",
  modified: "Modify",
};

function WorkspaceRestoreDialog({
  confirmation,
}: {
  confirmation: RestoreConfirmation;
}) {
  const changes = confirmation?.changes ?? [];
  const conversationChanges = changes.filter(
    (change) => change.scope === "conversation"
  );
  const sharedChanges = changes.filter((change) => change.scope === "shared");

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          confirmation?.onCancel();
        }
      }}
      open={Boolean(confirmation)}
    >
      <AlertDialogContent className="max-w-[min(92vw,560px)]">
        <AlertDialogHeader>
          <AlertDialogTitle>Restore workspace files?</AlertDialogTitle>
          <AlertDialogDescription>
            Continuing will restore this checkpoint before the message action
            runs. Project shared files can affect other chats in this project.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div
          className="max-h-72 overflow-y-auto rounded-md border border-border/40 bg-muted/20 p-2 text-[12px]"
          data-testid="workspace-restore-warning"
        >
          <RestoreChangeGroup
            changes={conversationChanges}
            title="Conversation workspace"
          />
          <RestoreChangeGroup
            changes={sharedChanges}
            title="Project shared workspace"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => confirmation?.onConfirm()}
            variant="destructive"
          >
            Restore files
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RestoreChangeGroup({
  changes,
  title,
}: {
  changes: WorkspaceChange[];
  title: string;
}) {
  if (changes.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1 [&+&]:mt-3">
      <div className="font-medium text-foreground">{title}</div>
      {changes.map((change) => (
        <div
          className="grid grid-cols-[64px_1fr] items-start gap-2 rounded-sm px-1.5 py-1 text-muted-foreground"
          key={`${change.scope}:${change.path}:${change.change}`}
        >
          <span
            className={cn(
              "font-medium",
              change.change === "created" && "text-emerald-600",
              change.change === "modified" && "text-amber-600",
              change.change === "deleted" && "text-destructive"
            )}
          >
            {restoreChangeLabels[change.change]}
          </span>
          <code className="min-w-0 break-all font-mono text-foreground">
            {change.path}
          </code>
        </div>
      ))}
    </div>
  );
}

export function ChatShell() {
  const {
    chatId,
    messages,
    setMessages,
    sendMessage,
    cancelEditMessage,
    editingMessage,
    restoreConfirmation,
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
                editingMessage={editingMessage}
                input={input}
                isLoading={isLoading}
                messages={messages}
                onCancelEdit={cancelEditMessage}
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
      <WorkspaceRestoreDialog confirmation={restoreConfirmation} />
    </div>
  );
}
