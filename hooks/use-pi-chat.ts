"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import type { PiStreamEvent } from "@/lib/pi/events";
import type {
  ChatMessage,
  ChatStatus,
  PiToolUIPart,
  SendMessage,
  SetMessages,
  WorkspaceDisplayIntent,
} from "@/lib/types";
import { fetcher, generateUUID } from "@/lib/utils";
import { useProjects } from "./use-projects";

function extractChatId(pathname: string): string | null {
  const match = pathname.match(/\/chat\/([^/]+)/);
  return match ? match[1] : null;
}

function mergeTextDelta(message: ChatMessage, delta: string) {
  const lastPart = message.parts.at(-1);
  if (lastPart?.type === "text") {
    lastPart.text += delta;
  } else {
    message.parts.push({ type: "text", text: delta });
  }
}

function mergeThinkingDelta(message: ChatMessage, delta: string) {
  const lastPart = message.parts.at(-1);
  if (lastPart?.type === "reasoning") {
    lastPart.text += delta;
    lastPart.state = "streaming";
  } else {
    message.parts.push({ type: "reasoning", text: delta, state: "streaming" });
  }
}

function finishActiveReasoning(message: ChatMessage) {
  const lastPart = message.parts.at(-1);
  if (lastPart?.type === "reasoning" && lastPart.state === "streaming") {
    lastPart.state = "done";
  }
}

function findToolPart(message: ChatMessage, toolCallId: string) {
  return message.parts.find(
    (part): part is PiToolUIPart =>
      part.type === "tool-pi" && part.toolCallId === toolCallId
  );
}

function updateAssistantMessage(
  messages: ChatMessage[],
  assistantId: string,
  event: PiStreamEvent
) {
  return messages.map((message) => {
    if (message.id !== assistantId || message.role !== "assistant") {
      return message;
    }

    const next: ChatMessage = {
      ...message,
      parts: message.parts.map((part) => ({ ...part })),
    };

    if (event.type === "text-delta") {
      finishActiveReasoning(next);
      mergeTextDelta(next, event.delta);
    }

    if (event.type === "thinking-delta") {
      mergeThinkingDelta(next, event.delta);
    }

    if (event.type === "tool-input-start") {
      finishActiveReasoning(next);
      const toolPart = findToolPart(next, event.toolCallId);
      if (toolPart) {
        toolPart.state = "input-streaming";
        toolPart.toolName = event.toolName;
        toolPart.inputText = event.inputText ?? "";
      } else {
        next.parts.push({
          type: "tool-pi",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          state: "input-streaming",
          inputText: event.inputText ?? "",
        });
      }
    }

    if (event.type === "tool-input-delta") {
      finishActiveReasoning(next);
      const toolPart = findToolPart(next, event.toolCallId);
      if (toolPart) {
        toolPart.state = "input-streaming";
        toolPart.toolName = event.toolName;
        toolPart.inputText = event.inputText;
      } else {
        next.parts.push({
          type: "tool-pi",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          state: "input-streaming",
          inputText: event.inputText,
        });
      }
    }

    if (event.type === "tool-start") {
      finishActiveReasoning(next);
      const toolPart = findToolPart(next, event.toolCallId);
      if (toolPart) {
        toolPart.state = "input-available";
        toolPart.toolName = event.toolName;
        toolPart.input = event.input;
        toolPart.inputText = undefined;
      } else {
        next.parts.push({
          type: "tool-pi",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          state: "input-available",
          input: event.input,
        });
      }
    }

    if (event.type === "tool-update") {
      finishActiveReasoning(next);
      const toolPart = findToolPart(next, event.toolCallId);
      if (toolPart) {
        toolPart.output = event.output;
      }
    }

    if (event.type === "tool-end") {
      finishActiveReasoning(next);
      const toolPart = findToolPart(next, event.toolCallId);
      if (toolPart) {
        toolPart.state = event.isError ? "output-error" : "output-available";
        toolPart.output = event.output;
        toolPart.displayIntent = event.displayIntent;
        toolPart.errorText = event.errorText;
        toolPart.isError = event.isError;
      } else {
        next.parts.push({
          type: "tool-pi",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          state: event.isError ? "output-error" : "output-available",
          output: event.output,
          displayIntent: event.displayIntent,
          errorText: event.errorText,
          isError: event.isError,
        });
      }
    }

    if (event.type === "error") {
      finishActiveReasoning(next);
      mergeTextDelta(next, event.message);
    }

    if (event.type === "done") {
      next.parts = next.parts.map((part) =>
        part.type === "reasoning" ? { ...part, state: "done" } : part
      );
    }

    return next;
  });
}

async function* readNdjson(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        yield JSON.parse(line) as PiStreamEvent;
      }
      newlineIndex = buffer.indexOf("\n");
    }
  }

  const line = buffer.trim();
  if (line) {
    yield JSON.parse(line) as PiStreamEvent;
  }
}

export function usePiChat() {
  const pathname = usePathname();
  const { mutate } = useSWRConfig();
  const { selectedProjectId, setSelectedProjectId } = useProjects();

  const chatIdFromUrl = extractChatId(pathname);
  const isNewChat = !chatIdFromUrl;
  const newChatIdRef = useRef(generateUUID());
  const prevPathnameRef = useRef(pathname);

  if (isNewChat && prevPathnameRef.current !== pathname) {
    newChatIdRef.current = generateUUID();
  }
  prevPathnameRef.current = pathname;

  const chatId = chatIdFromUrl ?? newChatIdRef.current;
  const [messages, setMessagesState] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [input, setInput] = useState("");
  const [currentModelId, setCurrentModelId] = useState(DEFAULT_CHAT_MODEL);
  const [latestWorkspaceDisplayIntent, setLatestWorkspaceDisplayIntent] =
    useState<WorkspaceDisplayIntent | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Tracks which chat the in-memory `messages` belong to so we only hydrate
  // from the server when the user actually switches chats — not on every
  // status change, which would clobber a freshly streamed reply with stale
  // (empty) server data.
  const loadedChatIdRef = useRef<string | null>(null);

  const messagesKey = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/messages?chatId=${chatId}`;

  const { data: chatData, isLoading } = useSWR(
    isNewChat ? null : messagesKey,
    fetcher,
    { revalidateOnFocus: false }
  );

  const setMessages: SetMessages = useCallback((nextMessages) => {
    setMessagesState((current) =>
      typeof nextMessages === "function" ? nextMessages(current) : nextMessages
    );
  }, []);

  useEffect(() => {
    // Brand-new chat: reset to an empty thread once, when we first land on it.
    if (isNewChat) {
      if (loadedChatIdRef.current !== chatId) {
        setMessagesState([]);
        setLatestWorkspaceDisplayIntent(null);
        loadedChatIdRef.current = chatId;
      }
      return;
    }
    // Existing chat: hydrate from the server only when switching into a chat
    // we haven't loaded yet. Once loaded (or after streaming a live turn),
    // the in-memory messages are the source of truth and must not be
    // overwritten by stale SWR data.
    if (chatData?.messages && loadedChatIdRef.current !== chatId) {
      setMessagesState(chatData.messages);
      setLatestWorkspaceDisplayIntent(null);
      loadedChatIdRef.current = chatId;
    }
    if (chatData?.projectId) {
      setSelectedProjectId(chatData.projectId);
    }
  }, [
    chatData?.messages,
    chatData?.projectId,
    chatId,
    isNewChat,
    setSelectedProjectId,
  ]);

  const refreshHistory = useCallback(() => {
    mutate((key) => typeof key === "string" && key.includes("/api/history"));
  }, [mutate]);

  const sendMessage: SendMessage = useCallback(
    async (message) => {
      if (!selectedProjectId) {
        toast.error("Select a project before sending a message.");
        return;
      }

      const userMessage: ChatMessage = {
        id: message.id ?? generateUUID(),
        role: "user",
        parts: message.parts,
        metadata: { createdAt: new Date().toISOString() },
      };
      const assistantMessage: ChatMessage = {
        id: generateUUID(),
        role: "assistant",
        parts: [],
        metadata: { createdAt: new Date().toISOString() },
      };

      setMessagesState((current) => [...current, userMessage]);
      setStatus("submitted");

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat`,
          {
            method: "POST",
            body: JSON.stringify({
              id: chatId,
              projectId: selectedProjectId,
              message: userMessage,
              selectedChatModel: currentModelId,
            }),
            signal: abortController.signal,
          }
        );

        if (!response.ok || !response.body) {
          const error = await response.json().catch(() => null);
          throw new Error(error?.cause || error?.message || "Request failed");
        }

        setMessagesState((current) => [...current, assistantMessage]);
        setStatus("streaming");

        for await (const event of readNdjson(response.body)) {
          if (event.type === "title") {
            refreshHistory();
            continue;
          }

          if (event.type === "workspace-display") {
            setLatestWorkspaceDisplayIntent(event.intent);
            continue;
          }

          if (event.type === "tool-end" && event.displayIntent) {
            setLatestWorkspaceDisplayIntent(event.displayIntent);
          }

          setMessagesState((current) =>
            updateAssistantMessage(current, assistantMessage.id, event)
          );

          if (event.type === "error") {
            throw new Error(event.message);
          }
        }

        setStatus("ready");
        refreshHistory();
        // Refresh the persisted-messages cache so revisiting this chat later
        // reflects the saved turn instead of the empty snapshot fetched when
        // the chat was first created.
        mutate(messagesKey);
      } catch (error) {
        if ((error as DOMException).name === "AbortError") {
          setStatus("ready");
        } else {
          toast.error(
            error instanceof Error ? error.message : "Pi failed to respond."
          );
          setStatus("error");
        }
      } finally {
        abortControllerRef.current = null;
      }
    },
    [
      chatId,
      currentModelId,
      messagesKey,
      mutate,
      refreshHistory,
      selectedProjectId,
    ]
  );

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    setMessagesState((current) =>
      current.map((message) => ({
        ...message,
        parts: message.parts.map((part) =>
          part.type === "reasoning" ? { ...part, state: "done" } : part
        ),
      }))
    );
    setStatus("ready");
  }, []);

  return useMemo(
    () => ({
      chatId,
      messages,
      setMessages,
      sendMessage,
      status,
      stop,
      input,
      setInput,
      isReadonly: false,
      isLoading: !isNewChat && isLoading,
      currentModelId,
      setCurrentModelId,
      latestWorkspaceDisplayIntent,
    }),
    [
      chatId,
      messages,
      setMessages,
      sendMessage,
      status,
      stop,
      input,
      isNewChat,
      isLoading,
      currentModelId,
      latestWorkspaceDisplayIntent,
    ]
  );
}
