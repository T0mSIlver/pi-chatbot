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
} from "@/lib/types";
import { usePiChat } from "./use-pi-chat";

type ActiveChatContextValue = {
  chatId: string;
  messages: ChatMessage[];
  setMessages: SetMessages;
  sendMessage: SendMessage;
  status: ChatStatus;
  stop: () => void;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  isReadonly: boolean;
  isLoading: boolean;
  currentModelId: string;
  setCurrentModelId: (id: string) => void;
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
