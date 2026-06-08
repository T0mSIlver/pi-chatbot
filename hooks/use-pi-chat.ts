"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import {
  type ChatHistory,
  getChatHistoryPaginationKey,
} from "@/lib/chat-history";
import type { PiStreamEvent } from "@/lib/pi/events";
import { applyPiStreamEventToMessages } from "@/lib/pi/stream-state";
import type {
  ChatMessage,
  ChatStatus,
  SendMessage,
  SetMessages,
  WorkspaceChange,
  WorkspaceDisplayIntent,
} from "@/lib/types";
import { fetcher, generateUUID } from "@/lib/utils";
import { useProjects } from "./use-projects";

function extractChatId(pathname: string): string | null {
  const match = pathname.match(/\/chat\/([^/]+)/);
  return match ? match[1] : null;
}

const ROOT_CHECKPOINT_ID = "root";

type PendingEdit = {
  messageId: string;
  branchFromEntryId: string | null;
  checkpointId: string;
  originalText: string;
};

type ChatRuntimeState = {
  messages: ChatMessage[];
  status: ChatStatus;
  latestWorkspaceDisplayIntent: WorkspaceDisplayIntent | null;
};

type ChatRuntimeStates = Record<string, ChatRuntimeState>;

type RestorePlan = {
  checkpointId: string;
  changes: WorkspaceChange[];
  missingCheckpoint: boolean;
};

const emptyRuntimeState: ChatRuntimeState = {
  messages: [],
  status: "ready",
  latestWorkspaceDisplayIntent: null,
};

function createEmptyRuntimeState(): ChatRuntimeState {
  return {
    messages: [],
    status: "ready",
    latestWorkspaceDisplayIntent: null,
  };
}

function isRunningStatus(status: ChatStatus) {
  return status === "submitted" || status === "streaming";
}

function textFromMessage(message: ChatMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function replayableUserParts(message: ChatMessage) {
  return message.parts.filter(
    (part) => part.type === "text" || part.type === "file"
  );
}

function checkpointBefore(message: ChatMessage) {
  return message.metadata?.parentId ?? ROOT_CHECKPOINT_ID;
}

function latestAssistantMessageId(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "assistant")
    ?.id;
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
  const router = useRouter();
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
  const [chatRuntimeStates, setChatRuntimeStates] = useState<ChatRuntimeStates>(
    {}
  );
  const currentRuntimeState = chatRuntimeStates[chatId] ?? emptyRuntimeState;
  const messages = currentRuntimeState.messages;
  const status = currentRuntimeState.status;
  const latestWorkspaceDisplayIntent =
    currentRuntimeState.latestWorkspaceDisplayIntent;
  const runningChatIds = useMemo(
    () =>
      Object.entries(chatRuntimeStates)
        .filter(([, state]) => isRunningStatus(state.status))
        .map(([runtimeChatId]) => runtimeChatId),
    [chatRuntimeStates]
  );
  const [input, setInput] = useState("");
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [currentModelId, setCurrentModelId] = useState(DEFAULT_CHAT_MODEL);
  const abortControllersRef = useRef(new Map<string, AbortController>());
  const activeAssistantMessageIdsRef = useRef(new Map<string, string>());
  const pendingEditRef = useRef<PendingEdit | null>(null);
  const restoreConfirmationResolverRef = useRef<
    ((confirmed: boolean) => void) | null
  >(null);
  const [restoreConfirmationChanges, setRestoreConfirmationChanges] = useState<
    WorkspaceChange[] | null
  >(null);
  // Tracks chats already hydrated from the server so live in-memory streams are
  // not overwritten by stale SWR snapshots.
  const loadedChatIdsRef = useRef<Set<string>>(new Set());

  const messagesKey = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/messages?chatId=${chatId}`;

  pendingEditRef.current = pendingEdit;

  const { data: chatData, isLoading } = useSWR(
    isNewChat ? null : messagesKey,
    fetcher,
    { revalidateOnFocus: false }
  );
  const hydratedMessages = chatData?.messages;
  const hydratedProjectId = chatData?.projectId ?? null;
  const hasHydratedChatData = Boolean(chatData);

  const updateChatRuntimeState = useCallback(
    (
      targetChatId: string,
      updater: (state: ChatRuntimeState) => ChatRuntimeState
    ) => {
      setChatRuntimeStates((currentStates) => {
        const previousState =
          currentStates[targetChatId] ?? createEmptyRuntimeState();

        return {
          ...currentStates,
          [targetChatId]: updater(previousState),
        };
      });
    },
    []
  );

  const setChatMessages = useCallback(
    (
      targetChatId: string,
      nextMessages: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[])
    ) => {
      updateChatRuntimeState(targetChatId, (state) => ({
        ...state,
        messages:
          typeof nextMessages === "function"
            ? nextMessages(state.messages)
            : nextMessages,
      }));
    },
    [updateChatRuntimeState]
  );

  const setMessages: SetMessages = useCallback(
    (nextMessages) => {
      setChatMessages(chatId, nextMessages);
    },
    [chatId, setChatMessages]
  );

  useEffect(() => {
    // Brand-new chat: reset to an empty thread once, when we first land on it.
    if (isNewChat) {
      if (!loadedChatIdsRef.current.has(chatId)) {
        updateChatRuntimeState(chatId, () => createEmptyRuntimeState());
        setPendingEdit(null);
        loadedChatIdsRef.current.add(chatId);
      }
      return;
    }
    // Existing chat: hydrate from the server only when switching into a chat
    // we haven't loaded yet. Once loaded (or after streaming a live turn),
    // the in-memory messages are the source of truth and must not be
    // overwritten by stale SWR data.
    if (hydratedMessages && !loadedChatIdsRef.current.has(chatId)) {
      updateChatRuntimeState(chatId, () => ({
        ...createEmptyRuntimeState(),
        messages: hydratedMessages,
      }));
      setPendingEdit(null);
      loadedChatIdsRef.current.add(chatId);
    }
    if (!isNewChat && hasHydratedChatData) {
      setSelectedProjectId(hydratedProjectId);
    }
  }, [
    hasHydratedChatData,
    hydratedMessages,
    hydratedProjectId,
    chatId,
    isNewChat,
    setSelectedProjectId,
    updateChatRuntimeState,
  ]);

  const refreshHistory = useCallback(() => {
    mutate(
      unstable_serialize((pageIndex: number, previousPageData: ChatHistory) =>
        getChatHistoryPaginationKey(
          pageIndex,
          previousPageData,
          selectedProjectId
        )
      )
    );
    mutate((key) => typeof key === "string" && key.includes("/api/history"));
  }, [mutate, selectedProjectId]);

  const consumeChatStream = useCallback(
    async ({
      assistantMessageId,
      stream,
      targetChatId,
    }: {
      assistantMessageId: string;
      stream: ReadableStream<Uint8Array>;
      targetChatId: string;
    }) => {
      let activeAssistantMessageId = assistantMessageId;

      for await (const event of readNdjson(stream)) {
        if (event.type === "snapshot") {
          activeAssistantMessageId =
            latestAssistantMessageId(event.messages) ??
            activeAssistantMessageId;
          activeAssistantMessageIdsRef.current.set(
            targetChatId,
            activeAssistantMessageId
          );
          updateChatRuntimeState(targetChatId, (state) => ({
            ...state,
            latestWorkspaceDisplayIntent:
              event.latestWorkspaceDisplayIntent ?? null,
            messages: event.messages,
            status: event.status,
          }));
          continue;
        }

        if (event.type === "title") {
          refreshHistory();
          continue;
        }

        if (event.type === "workspace-display") {
          updateChatRuntimeState(targetChatId, (state) => ({
            ...state,
            latestWorkspaceDisplayIntent: event.intent,
          }));
          continue;
        }

        if (event.type === "tool-end" && event.displayIntent) {
          updateChatRuntimeState(targetChatId, (state) => ({
            ...state,
            latestWorkspaceDisplayIntent: event.displayIntent ?? null,
          }));
        }

        setChatMessages(targetChatId, (current) =>
          applyPiStreamEventToMessages({
            assistantMessageId: activeAssistantMessageId,
            event,
            messages: current,
          })
        );

        if (event.type === "stopped") {
          updateChatRuntimeState(targetChatId, (state) => ({
            ...state,
            status: "ready",
          }));
          return;
        }

        if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    },
    [refreshHistory, setChatMessages, updateChatRuntimeState]
  );

  useEffect(() => {
    if (isNewChat || abortControllersRef.current.has(chatId)) {
      return;
    }

    const abortController = new AbortController();
    let attached = false;

    const attachToRunningChat = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat/${chatId}/stream`,
          { signal: abortController.signal }
        );

        if (response.status === 204) {
          return;
        }

        if (!response.ok || !response.body) {
          return;
        }

        attached = true;
        abortControllersRef.current.set(chatId, abortController);
        loadedChatIdsRef.current.add(chatId);

        await consumeChatStream({
          assistantMessageId:
            activeAssistantMessageIdsRef.current.get(chatId) ?? generateUUID(),
          stream: response.body,
          targetChatId: chatId,
        });

        updateChatRuntimeState(chatId, (state) => ({
          ...state,
          status: "ready",
        }));
        refreshHistory();
        mutate(messagesKey);
      } catch (error) {
        if ((error as DOMException).name !== "AbortError") {
          toast.error(
            error instanceof Error ? error.message : "Pi failed to respond."
          );
          updateChatRuntimeState(chatId, (state) => ({
            ...state,
            status: "error",
          }));
        }
      } finally {
        if (abortControllersRef.current.get(chatId) === abortController) {
          abortControllersRef.current.delete(chatId);
        }
      }
    };

    attachToRunningChat();

    return () => {
      abortController.abort();
      if (
        attached &&
        abortControllersRef.current.get(chatId) === abortController
      ) {
        abortControllersRef.current.delete(chatId);
      }
    };
  }, [
    chatId,
    consumeChatStream,
    isNewChat,
    messagesKey,
    mutate,
    refreshHistory,
    updateChatRuntimeState,
  ]);

  const resolveRestoreConfirmation = useCallback((confirmed: boolean) => {
    const resolver = restoreConfirmationResolverRef.current;
    restoreConfirmationResolverRef.current = null;
    setRestoreConfirmationChanges(null);
    resolver?.(confirmed);
  }, []);

  const requestRestoreConfirmation = useCallback(
    (changes: WorkspaceChange[]) =>
      new Promise<boolean>((resolve) => {
        restoreConfirmationResolverRef.current?.(false);
        restoreConfirmationResolverRef.current = resolve;
        setRestoreConfirmationChanges(changes);
      }),
    []
  );

  useEffect(
    () => () => {
      restoreConfirmationResolverRef.current?.(false);
      restoreConfirmationResolverRef.current = null;
    },
    []
  );

  const planRestore = useCallback(
    async (
      checkpointId: string,
      destination: "current" | "new-chat" = "current"
    ) => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/workspace/restore/plan`,
        {
          method: "POST",
          body: JSON.stringify({
            chatId,
            checkpointId,
            destination,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.cause || error?.message || "Restore failed");
      }

      return (await response.json()) as RestorePlan;
    },
    [chatId]
  );

  const confirmRestorePlan = useCallback(
    async (
      checkpointId: string,
      destination: "current" | "new-chat" = "current"
    ) => {
      const plan = await planRestore(checkpointId, destination);

      if (plan.missingCheckpoint) {
        toast.warning("No workspace checkpoint is available for this point.");
        return { ok: true, shouldRestore: false, plan };
      }

      if (plan.changes.length === 0) {
        return { ok: true, shouldRestore: false, plan };
      }

      const confirmed = await requestRestoreConfirmation(plan.changes);
      if (!confirmed) {
        return { ok: false, shouldRestore: false, plan };
      }

      return { ok: true, shouldRestore: true, plan };
    },
    [planRestore, requestRestoreConfirmation]
  );

  const restoreCurrentWorkspace = useCallback(
    async (checkpointId: string) => {
      const restore = await confirmRestorePlan(checkpointId);

      if (!restore.ok) {
        return false;
      }

      if (!restore.shouldRestore) {
        return true;
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/workspace/restore`,
        {
          method: "POST",
          body: JSON.stringify({
            chatId,
            checkpointId,
            confirmed: true,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.cause || error?.message || "Restore failed");
      }

      return true;
    },
    [chatId, confirmRestorePlan]
  );

  const sendMessage: SendMessage = useCallback(
    async (message, options) => {
      const targetChatId = chatId;
      const targetModelId = currentModelId;
      const targetMessagesKey = `${
        process.env.NEXT_PUBLIC_BASE_PATH ?? ""
      }/api/messages?chatId=${targetChatId}`;

      if (abortControllersRef.current.has(targetChatId)) {
        toast.error("This conversation is already running.");
        return false;
      }

      const pendingEditOptions = pendingEditRef.current
        ? {
            branchFromEntryId: pendingEditRef.current.branchFromEntryId,
            replaceFromMessageId: pendingEditRef.current.messageId,
            restoreCheckpointId: pendingEditRef.current.checkpointId,
          }
        : undefined;
      const editOptions =
        pendingEditOptions || options
          ? { ...pendingEditOptions, ...options }
          : undefined;

      try {
        if (editOptions?.restoreCheckpointId) {
          const restored = await restoreCurrentWorkspace(
            editOptions.restoreCheckpointId
          );
          if (!restored) {
            return false;
          }
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to restore workspace."
        );
        return false;
      }

      const userMessageId = message.id ?? generateUUID();
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: "user",
        parts: message.parts,
        metadata: {
          checkpointId: userMessageId,
          createdAt: new Date().toISOString(),
          parentId: editOptions?.branchFromEntryId ?? undefined,
        },
      };
      const assistantMessage: ChatMessage = {
        id: generateUUID(),
        role: "assistant",
        parts: [],
        metadata: { createdAt: new Date().toISOString() },
      };
      activeAssistantMessageIdsRef.current.set(
        targetChatId,
        assistantMessage.id
      );

      setPendingEdit(null);
      editOptions?.onAccepted?.();
      loadedChatIdsRef.current.add(targetChatId);
      updateChatRuntimeState(targetChatId, (state) => {
        const nextMessages = (() => {
          if (!editOptions?.replaceFromMessageId) {
            return [...state.messages, userMessage];
          }

          const replaceIndex = state.messages.findIndex(
            (candidate) => candidate.id === editOptions.replaceFromMessageId
          );

          if (replaceIndex < 0) {
            return [...state.messages, userMessage];
          }

          return [...state.messages.slice(0, replaceIndex), userMessage];
        })();

        return {
          ...state,
          latestWorkspaceDisplayIntent: null,
          messages: nextMessages,
          status: "submitted",
        };
      });

      const abortController = new AbortController();
      abortControllersRef.current.set(targetChatId, abortController);

      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat`,
          {
            method: "POST",
            body: JSON.stringify({
              id: targetChatId,
              assistantMessageId: assistantMessage.id,
              message: userMessage,
              projectId: selectedProjectId ?? undefined,
              selectedChatModel: targetModelId,
              branchFromEntryId: editOptions?.branchFromEntryId,
            }),
            signal: abortController.signal,
          }
        );

        if (!response.ok || !response.body) {
          const error = await response.json().catch(() => null);
          throw new Error(error?.cause || error?.message || "Request failed");
        }

        updateChatRuntimeState(targetChatId, (state) => ({
          ...state,
          messages: [...state.messages, assistantMessage],
          status: "streaming",
        }));

        await consumeChatStream({
          assistantMessageId: assistantMessage.id,
          stream: response.body,
          targetChatId,
        });

        updateChatRuntimeState(targetChatId, (state) => ({
          ...state,
          status: "ready",
        }));
        refreshHistory();
        // Refresh the persisted-messages cache so revisiting this chat later
        // reflects the saved turn instead of the empty snapshot fetched when
        // the chat was first created.
        mutate(targetMessagesKey);
        return true;
      } catch (error) {
        if ((error as DOMException).name === "AbortError") {
          updateChatRuntimeState(targetChatId, (state) => ({
            ...state,
            status: "ready",
          }));
        } else {
          toast.error(
            error instanceof Error ? error.message : "Pi failed to respond."
          );
          updateChatRuntimeState(targetChatId, (state) => ({
            ...state,
            status: "error",
          }));
        }
        return true;
      } finally {
        if (abortControllersRef.current.get(targetChatId) === abortController) {
          abortControllersRef.current.delete(targetChatId);
        }
      }
    },
    [
      chatId,
      consumeChatStream,
      currentModelId,
      mutate,
      refreshHistory,
      restoreCurrentWorkspace,
      selectedProjectId,
      updateChatRuntimeState,
    ]
  );

  const stop = useCallback(() => {
    fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat/${chatId}/stop`,
      { method: "POST" }
    ).catch(() => undefined);
    abortControllersRef.current.get(chatId)?.abort();
    abortControllersRef.current.delete(chatId);
    updateChatRuntimeState(chatId, (state) => ({
      ...state,
      messages: applyPiStreamEventToMessages({
        assistantMessageId:
          activeAssistantMessageIdsRef.current.get(chatId) ??
          latestAssistantMessageId(state.messages) ??
          generateUUID(),
        event: { type: "stopped" },
        messages: state.messages,
      }),
      status: "ready",
    }));
  }, [chatId, updateChatRuntimeState]);

  const startEditMessage = useCallback(
    (messageId: string) => {
      const message = messages.find((candidate) => candidate.id === messageId);
      if (message?.role !== "user") {
        return;
      }

      const originalText = textFromMessage(message);
      if (!originalText) {
        return;
      }

      setPendingEdit({
        branchFromEntryId: message.metadata?.parentId ?? null,
        checkpointId: checkpointBefore(message),
        messageId: message.id,
        originalText,
      });
      setInput(originalText);
    },
    [messages]
  );

  const cancelEditMessage = useCallback(() => {
    setPendingEdit(null);
    setInput("");
  }, []);

  const regenerateMessage = useCallback(
    async (messageId: string) => {
      const assistantIndex = messages.findIndex(
        (candidate) => candidate.id === messageId
      );
      if (assistantIndex < 0) {
        return;
      }

      const userMessage = [...messages]
        .slice(0, assistantIndex)
        .reverse()
        .find((candidate) => candidate.role === "user");
      if (!userMessage) {
        toast.error("No user message found to regenerate from.");
        return;
      }

      const parts = replayableUserParts(userMessage);
      if (parts.length === 0) {
        toast.error("No user text found to regenerate from.");
        return;
      }

      await sendMessage(
        {
          role: "user",
          parts,
        },
        {
          branchFromEntryId: userMessage.metadata?.parentId ?? null,
          replaceFromMessageId: userMessage.id,
          restoreCheckpointId: checkpointBefore(userMessage),
        }
      );
    },
    [messages, sendMessage]
  );

  const branchMessage = useCallback(
    async (messageId: string) => {
      const message = messages.find((candidate) => candidate.id === messageId);
      if (!message) {
        return;
      }

      const checkpointId =
        message.role === "user"
          ? checkpointBefore(message)
          : (message.metadata?.checkpointId ?? message.id);
      const entryId =
        message.role === "assistant"
          ? (message.metadata?.checkpointId ?? message.id)
          : message.id;

      try {
        const restore = await confirmRestorePlan(checkpointId, "new-chat");
        if (!restore.ok) {
          return;
        }

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat/branch`,
          {
            method: "POST",
            body: JSON.stringify({
              chatId,
              entryId,
              restoreCheckpointId: restore.shouldRestore
                ? checkpointId
                : undefined,
              confirmedRestore: restore.shouldRestore,
            }),
          }
        );

        if (!response.ok) {
          const error = await response.json().catch(() => null);
          throw new Error(error?.cause || error?.message || "Branch failed");
        }

        const result = (await response.json()) as {
          chatId: string;
          url: string;
        };
        refreshHistory();
        router.push(result.url);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to branch conversation."
        );
      }
    },
    [chatId, confirmRestorePlan, messages, refreshHistory, router]
  );

  return useMemo(
    () => ({
      chatId,
      messages,
      setMessages,
      sendMessage,
      startEditMessage,
      cancelEditMessage,
      regenerateMessage,
      branchMessage,
      editingMessage: pendingEdit,
      restoreConfirmation: restoreConfirmationChanges
        ? {
            changes: restoreConfirmationChanges,
            onCancel: () => resolveRestoreConfirmation(false),
            onConfirm: () => resolveRestoreConfirmation(true),
          }
        : null,
      status,
      stop,
      input,
      setInput,
      isReadonly: false,
      isLoading: !isNewChat && isLoading,
      currentModelId,
      setCurrentModelId,
      latestWorkspaceDisplayIntent,
      runningChatIds,
    }),
    [
      chatId,
      messages,
      setMessages,
      sendMessage,
      startEditMessage,
      cancelEditMessage,
      regenerateMessage,
      branchMessage,
      pendingEdit,
      restoreConfirmationChanges,
      resolveRestoreConfirmation,
      status,
      stop,
      input,
      isNewChat,
      isLoading,
      currentModelId,
      latestWorkspaceDisplayIntent,
      runningChatIds,
    ]
  );
}
