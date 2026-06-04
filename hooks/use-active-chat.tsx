"use client";

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
} from "react";
import type {
  ChatMessage,
  ChatStatus,
  SendMessage,
  SetMessages,
  WorkspaceChange,
  WorkspaceDisplayIntent,
} from "@/lib/types";
import { usePiChat } from "./use-pi-chat";

type ActiveChatContextValue = {
  chatId: string;
  messages: ChatMessage[];
  setMessages: SetMessages;
  sendMessage: SendMessage;
  startEditMessage: (messageId: string) => void;
  cancelEditMessage: () => void;
  regenerateMessage: (messageId: string) => Promise<void>;
  branchMessage: (messageId: string) => Promise<void>;
  editingMessage: {
    messageId: string;
    originalText: string;
  } | null;
  restoreConfirmation: {
    changes: WorkspaceChange[];
    onCancel: () => void;
    onConfirm: () => void;
  } | null;
  status: ChatStatus;
  stop: () => void;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  isReadonly: boolean;
  isLoading: boolean;
  currentModelId: string;
  setCurrentModelId: (id: string) => void;
  latestWorkspaceDisplayIntent: WorkspaceDisplayIntent | null;
};

const ActiveChatContext = createContext<ActiveChatContextValue | null>(null);

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const value = usePiChat();

  return (
    <ActiveChatContext.Provider value={value}>
      {children}
    </ActiveChatContext.Provider>
  );
}

export function useActiveChat() {
  const context = useContext(ActiveChatContext);
  if (!context) {
    throw new Error("useActiveChat must be used within ActiveChatProvider");
  }
  return context;
}
