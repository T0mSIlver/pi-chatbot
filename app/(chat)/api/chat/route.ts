import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { ipAddress } from "@vercel/functions";
import { auth } from "@/app/(auth)/auth";
import { allowedModelIds, DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { isTestEnvironment } from "@/lib/constants";
import {
  deleteChatById,
  ensureLocalNetworkProject,
  getChatById,
  getProjectById,
  saveChat,
  updateChatMetadataById,
  updateChatPiSessionFilePathById,
} from "@/lib/db/queries";
import type { Chat } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import { type ChatRun, startChatRun } from "@/lib/pi/chat-runs";
import { generateConversationMetadata } from "@/lib/pi/conversation-metadata";
import { piEntriesToChatMessages } from "@/lib/pi/jsonl";
import { createPiSdkSession } from "@/lib/pi/session";
import {
  ensureConversationWorkspace,
  ensureProjectWorkspace,
  getConversationWorkspacePath,
  moveWorkspaceToTrash,
} from "@/lib/pi/workspace";
import {
  createWorkspaceCheckpoint,
  ROOT_WORKSPACE_CHECKPOINT_ID,
} from "@/lib/pi/workspace-checkpoints";
import {
  diffWorkspaceSnapshots,
  displayIntentFromToolResult,
  getWorkspaceRoots,
  snapshotWorkspaceFiles,
  writeWorkspaceChanges,
} from "@/lib/pi/workspace-files";
import { checkIpRateLimit } from "@/lib/ratelimit";
import type { ChatMessage } from "@/lib/types";
import { generateUUID, getTextFromMessage } from "@/lib/utils";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 300;

function contentToText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter(
      (block): block is { type: string; text?: string } =>
        typeof block === "object" && block !== null && "type" in block
    )
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

function previewToolOutput(value: unknown) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2);
  if (text.length <= 8000) {
    return value;
  }
  return `${text.slice(0, 8000)}\n\n[truncated for display]`;
}

function createInitialConversationTitle(message: PostRequestBody["message"]) {
  const text = getTextFromMessage(message).replace(/\s+/g, " ").trim();

  if (!text) {
    return "New conversation";
  }

  const normalized = text
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .trim();
  if (
    ["hi", "hello", "hey", "yo", "test"].includes(normalized) ||
    normalized.length < 3
  ) {
    return "New conversation";
  }

  const title = text
    .replace(/^["'#*\s]+/, "")
    .replace(/[".?!]+$/g, "")
    .split(/\s+/)
    .slice(0, 8)
    .join(" ")
    .trim();

  return title.length > 60 ? `${title.slice(0, 57).trim()}...` : title;
}

function createSubmittedMessages({
  assistantMessageId,
  branchFromEntryId,
  existingMessages,
  message,
}: {
  assistantMessageId: string;
  branchFromEntryId?: string | null;
  existingMessages: ChatMessage[];
  message: PostRequestBody["message"];
}) {
  const userMessage: ChatMessage = {
    id: message.id,
    role: "user",
    parts: message.parts,
    metadata: {
      checkpointId: message.id,
      createdAt: new Date().toISOString(),
      parentId: branchFromEntryId ?? undefined,
    },
  };
  const assistantMessage: ChatMessage = {
    id: assistantMessageId,
    role: "assistant",
    parts: [],
    metadata: { createdAt: new Date().toISOString() },
  };

  return [...existingMessages, userMessage, assistantMessage];
}

type StreamingToolCall = {
  toolCallId: string;
  toolName: string;
  inputText: string;
};

function getAssistantToolCallBlock(event: unknown) {
  if (typeof event !== "object" || event === null) {
    return null;
  }

  const contentIndex =
    "contentIndex" in event && typeof event.contentIndex === "number"
      ? event.contentIndex
      : undefined;
  const partial = "partial" in event ? event.partial : undefined;

  if (
    typeof partial !== "object" ||
    partial === null ||
    !("content" in partial) ||
    !Array.isArray(partial.content) ||
    contentIndex === undefined
  ) {
    return null;
  }

  const block = partial.content[contentIndex];
  if (
    typeof block !== "object" ||
    block === null ||
    !("type" in block) ||
    block.type !== "toolCall"
  ) {
    return null;
  }

  return {
    contentIndex,
    id: "id" in block && typeof block.id === "string" ? block.id : undefined,
    name:
      "name" in block && typeof block.name === "string"
        ? block.name
        : undefined,
  };
}

async function getOrCreateProject(requestedProjectId?: string) {
  if (requestedProjectId) {
    const project = await getProjectById({ id: requestedProjectId });
    if (!project) {
      throw new ChatbotError("not_found:chat");
    }
    await ensureProjectWorkspace({
      userId: project.userId,
      projectId: project.id,
    });
    return project;
  }

  return ensureLocalNetworkProject();
}

async function imagePartToPiImage(part: { url: string; mediaType: string }) {
  const response = await fetch(part.url);
  if (!response.ok) {
    return null;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    type: "image" as const,
    data: bytes.toString("base64"),
    mimeType: part.mediaType,
  };
}

type RequestMessagePart = PostRequestBody["message"]["parts"][number];

function isImageFilePart(
  part: RequestMessagePart
): part is Extract<RequestMessagePart, { type: "file" }> {
  return part.type === "file" && part.mediaType.startsWith("image/");
}

async function buildPiUserContent(message: PostRequestBody["message"]) {
  const text = getTextFromMessage(message);
  const images = (
    await Promise.all(
      message.parts
        .filter(isImageFilePart)
        .map((part) => imagePartToPiImage(part))
    )
  ).filter((image) => image !== null);

  if (images.length === 0) {
    return text;
  }

  return [{ type: "text" as const, text }, ...images];
}

function waitForMockDelay(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    let timeout: ReturnType<typeof setTimeout>;
    const stopWaiting = () => {
      clearTimeout(timeout);
      resolve();
    };
    timeout = setTimeout(() => {
      signal.removeEventListener("abort", stopWaiting);
      resolve();
    }, 3000);

    signal.addEventListener("abort", stopWaiting, { once: true });
  });
}

function createConversationMetadata({
  id,
  userId,
  projectId,
  title,
  piSessionFilePath,
}: {
  id: string;
  userId: string;
  projectId: string;
  title: string;
  piSessionFilePath: string;
}) {
  return saveChat({
    id,
    userId,
    projectId,
    title,
    workspacePath: getConversationWorkspacePath({
      userId,
      projectId,
      conversationId: id,
    }),
    piSessionFilePath,
  });
}

function applyRequestedBranch(
  sessionManager: SessionManager,
  branchFromEntryId: string | null | undefined
) {
  if (branchFromEntryId === undefined) {
    return;
  }

  if (branchFromEntryId === null) {
    sessionManager.resetLeaf();
    return;
  }

  sessionManager.branch(branchFromEntryId);
}

function currentCheckpointId(sessionManager: SessionManager) {
  return sessionManager.getLeafId() ?? ROOT_WORKSPACE_CHECKPOINT_ID;
}

async function runMockPiTurn({
  assistantMessageId,
  chat,
  message,
  branchFromEntryId,
  run,
}: {
  assistantMessageId: string;
  chat: Chat;
  message: PostRequestBody["message"];
  branchFromEntryId?: string | null;
  run: ChatRun;
}) {
  const sessionFilePath = chat.piSessionFilePath;
  const timestamp = new Date().toISOString();
  const text = "This is a mocked Pi response for tests.";
  const userText = getTextFromMessage(message);
  const shouldDelay = /slow background/i.test(userText);
  const shouldMockInterleavedThinking = /interleaved thinking/i.test(userText);
  const displayIntent = {
    type: "workspace-file" as const,
    chatId: chat.id,
    scope: "conversation" as const,
    path: "mock-output.md",
    mode: "markdown" as const,
    title: "Mock workspace output",
  };
  const readToolCall = {
    type: "toolCall",
    id: "mock-tool",
    name: "read",
    arguments: { path: "README.md" },
  };
  const showcaseToolCall = {
    type: "toolCall",
    id: "mock-showcase-file",
    name: "showcase_file",
    arguments: { path: "mock-output.md", mode: "markdown" },
  };
  const assistantContent = shouldMockInterleavedThinking
    ? [
        {
          type: "thinking",
          thinking: "I should inspect the README first.",
        },
        readToolCall,
        {
          type: "thinking",
          thinking: "The README result is enough context.",
        },
        { type: "text", text },
      ]
    : [readToolCall, showcaseToolCall, { type: "text", text }];

  await mkdir(path.dirname(sessionFilePath), { recursive: true });
  const sessionManager = SessionManager.open(
    sessionFilePath,
    undefined,
    chat.workspacePath
  );
  applyRequestedBranch(sessionManager, branchFromEntryId);
  const beforeCheckpointId = currentCheckpointId(sessionManager);
  const roots = getWorkspaceRoots(chat);

  run.emit({
    type: "snapshot",
    messages: createSubmittedMessages({
      assistantMessageId,
      branchFromEntryId,
      existingMessages: piEntriesToChatMessages(
        sessionManager.getBranch(),
        chat.id
      ),
      message,
    }),
    status: "streaming",
  });

  if (shouldDelay) {
    await waitForMockDelay(run.abortSignal);
    if (run.abortSignal.aborted) {
      return sessionManager.getBranch();
    }
  }

  await createWorkspaceCheckpoint({
    roots,
    conversationPath: chat.workspacePath,
    checkpointId: beforeCheckpointId,
  });

  sessionManager.appendMessage({
    role: "user",
    content: userText,
    timestamp: Date.now(),
  });
  sessionManager.appendMessage({
    role: "assistant",
    content: assistantContent,
    timestamp: Date.now(),
  } as never);
  sessionManager.appendMessage({
    role: "toolResult",
    toolCallId: "mock-tool",
    toolName: "read",
    content: "mock tool output",
    isError: false,
    timestamp: Date.now(),
  } as never);

  if (!shouldMockInterleavedThinking) {
    sessionManager.appendMessage({
      role: "toolResult",
      toolCallId: "mock-showcase-file",
      toolName: "showcase_file",
      content: "Opened conversation:mock-output.md in the preview pane.",
      details: { displayIntent },
      isError: false,
      timestamp: Date.now(),
    } as never);
  }

  const mockMarkdownPath = path.join(chat.workspacePath, "mock-output.md");
  const mockAppPath = path.join(chat.workspacePath, "apps", "mock");
  const mockSharedPath = roots.sharedPath;
  await mkdir(mockAppPath, { recursive: true });
  await mkdir(mockSharedPath, { recursive: true });
  await writeFile(
    mockMarkdownPath,
    `# Mock workspace output\n\nCreated for ${chat.title} at ${timestamp}.\n`
  );
  await writeFile(
    path.join(mockSharedPath, "shared-note.txt"),
    `Shared workspace note for ${chat.title}.\n`
  );
  await writeFile(
    path.join(mockAppPath, "index.html"),
    [
      "<!doctype html>",
      "<html>",
      '<head><meta charset="utf-8"><title>Mock app</title></head>',
      "<body><main><h1>Mock app</h1><p>Generated by the mocked Pi turn.</p></main></body>",
      "</html>",
    ].join("")
  );

  if (shouldMockInterleavedThinking) {
    run.emit({
      type: "thinking-delta",
      delta: "I should inspect the README first.",
    });
  }
  run.emit({
    type: "tool-start",
    toolCallId: "mock-tool",
    toolName: "read",
    input: { path: "README.md" },
  });
  run.emit({
    type: "tool-end",
    toolCallId: "mock-tool",
    toolName: "read",
    output: "mock tool output",
    isError: false,
  });
  if (shouldMockInterleavedThinking) {
    run.emit({
      type: "thinking-delta",
      delta: "The README result is enough context.",
    });
  } else {
    run.emit({
      type: "tool-start",
      toolCallId: "mock-showcase-file",
      toolName: "showcase_file",
      input: { path: "mock-output.md", mode: "markdown" },
    });
    run.emit({
      type: "tool-end",
      toolCallId: "mock-showcase-file",
      toolName: "showcase_file",
      output: "Opened conversation:mock-output.md in the preview pane.",
      displayIntent,
      isError: false,
    });
    run.emit({
      type: "workspace-display",
      intent: displayIntent,
    });
  }
  const afterCheckpointId = currentCheckpointId(sessionManager);
  await createWorkspaceCheckpoint({
    roots,
    conversationPath: chat.workspacePath,
    checkpointId: afterCheckpointId,
  });

  run.emit({ type: "text-delta", delta: text });
  run.emit({
    type: "done",
    sessionFilePath,
    messages: piEntriesToChatMessages(sessionManager.getBranch(), chat.id),
  });

  return sessionManager.getBranch();
}

async function producePiChatRun({
  assistantMessageId,
  requestBody,
  run,
  selectedChatModel,
}: {
  assistantMessageId: string;
  requestBody: PostRequestBody;
  run: ChatRun;
  selectedChatModel: string;
}) {
  let chat = await getChatById({ id: requestBody.id });
  let shouldGenerateMetadata = false;
  const initialTitle = createInitialConversationTitle(requestBody.message);

  if (!chat) {
    const project = await getOrCreateProject(requestBody.projectId);
    const workspace = await ensureConversationWorkspace({
      userId: project.userId,
      projectId: project.id,
      conversationId: requestBody.id,
    });

    shouldGenerateMetadata = true;

    if (isTestEnvironment) {
      chat = await createConversationMetadata({
        id: requestBody.id,
        userId: project.userId,
        projectId: project.id,
        title: initialTitle,
        piSessionFilePath: path.join(
          workspace.conversationPath,
          "pi-session.jsonl"
        ),
      });
    } else {
      const piSession = await createPiSdkSession({
        workspacePath: workspace.conversationPath,
        sharedPath: workspace.sharedPath,
        chatId: requestBody.id,
        selectedModelId: selectedChatModel,
      });
      chat = await createConversationMetadata({
        id: requestBody.id,
        userId: project.userId,
        projectId: project.id,
        title: initialTitle,
        piSessionFilePath: piSession.sessionFile ?? "",
      });
      piSession.dispose();
    }
  }

  if (!chat || run.abortSignal.aborted) {
    return;
  }

  const workspaceRoots = getWorkspaceRoots(chat);
  let piSession: Awaited<ReturnType<typeof createPiSdkSession>> | null = null;
  let unsubscribe: (() => void) | null = null;
  const abort = () => {
    piSession?.abort().catch(() => undefined);
  };

  try {
    if (shouldGenerateMetadata) {
      run.emit({
        type: "title",
        title: chat.title,
      });
    }

    const beforeSnapshot = await snapshotWorkspaceFiles(workspaceRoots);
    const persistWorkspaceChanges = async () => {
      const afterSnapshot = await snapshotWorkspaceFiles(workspaceRoots);
      await writeWorkspaceChanges({
        conversationPath: chat.workspacePath,
        changes: diffWorkspaceSnapshots(beforeSnapshot, afterSnapshot),
      });
    };

    if (isTestEnvironment) {
      const entries = await runMockPiTurn({
        assistantMessageId,
        chat,
        message: requestBody.message,
        branchFromEntryId: requestBody.branchFromEntryId,
        run,
      });
      await persistWorkspaceChanges();
      if (shouldGenerateMetadata) {
        const metadata = await generateConversationMetadata({
          chatId: chat.id,
          entries,
          selectedModelId: selectedChatModel,
          signal: run.abortSignal,
        });
        if (metadata) {
          await updateChatMetadataById({
            chatId: chat.id,
            title: metadata.title,
            summary: metadata.summary,
          });
          run.emit({
            type: "title",
            title: metadata.title,
          });
        }
      }
      return;
    }

    piSession = await createPiSdkSession({
      workspacePath: chat.workspacePath,
      sharedPath: workspaceRoots.sharedPath,
      chatId: chat.id,
      sessionFilePath: chat.piSessionFilePath,
      selectedModelId: selectedChatModel,
    });

    applyRequestedBranch(
      piSession.sessionManager,
      requestBody.branchFromEntryId
    );

    run.emit({
      type: "snapshot",
      messages: createSubmittedMessages({
        assistantMessageId,
        branchFromEntryId: requestBody.branchFromEntryId,
        existingMessages: piEntriesToChatMessages(
          piSession.sessionManager.getBranch(),
          chat.id
        ),
        message: requestBody.message,
      }),
      status: "streaming",
    });

    await createWorkspaceCheckpoint({
      roots: workspaceRoots,
      conversationPath: chat.workspacePath,
      checkpointId: currentCheckpointId(piSession.sessionManager),
    });

    if (
      piSession.sessionFile &&
      piSession.sessionFile !== chat.piSessionFilePath
    ) {
      await updateChatPiSessionFilePathById({
        chatId: chat.id,
        piSessionFilePath: piSession.sessionFile,
      });
    }

    run.abortSignal.addEventListener("abort", abort, { once: true });
    if (run.abortSignal.aborted) {
      abort();
      return;
    }

    const streamingToolCalls = new Map<string, StreamingToolCall>();

    unsubscribe = piSession.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        run.emit({
          type: "text-delta",
          delta: event.assistantMessageEvent.delta,
        });
      }

      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "thinking_delta"
      ) {
        run.emit({
          type: "thinking-delta",
          delta: event.assistantMessageEvent.delta,
        });
      }

      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "toolcall_start"
      ) {
        const block = getAssistantToolCallBlock(event.assistantMessageEvent);
        if (block) {
          const toolCallId = block.id ?? `tool-${block.contentIndex}`;
          const toolName = block.name ?? "tool";
          streamingToolCalls.set(String(block.contentIndex), {
            toolCallId,
            toolName,
            inputText: "",
          });
          run.emit({
            type: "tool-input-start",
            toolCallId,
            toolName,
          });
        }
      }

      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "toolcall_delta"
      ) {
        const block = getAssistantToolCallBlock(event.assistantMessageEvent);
        if (block) {
          const key = String(block.contentIndex);
          const existing = streamingToolCalls.get(key);
          const toolCallId =
            existing?.toolCallId ?? block.id ?? `tool-${block.contentIndex}`;
          const toolName = existing?.toolName ?? block.name ?? "tool";
          const delta =
            typeof event.assistantMessageEvent.delta === "string"
              ? event.assistantMessageEvent.delta
              : "";
          const inputText = `${existing?.inputText ?? ""}${delta}`;
          streamingToolCalls.set(key, {
            toolCallId,
            toolName,
            inputText,
          });
          run.emit({
            type: "tool-input-delta",
            toolCallId,
            toolName,
            inputText,
          });
        }
      }

      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "toolcall_end"
      ) {
        const block = getAssistantToolCallBlock(event.assistantMessageEvent);
        if (block) {
          streamingToolCalls.delete(String(block.contentIndex));
        }
      }

      if (event.type === "tool_execution_start") {
        run.emit({
          type: "tool-start",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.args,
        });
      }

      if (event.type === "tool_execution_update") {
        run.emit({
          type: "tool-update",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          output: previewToolOutput(event.partialResult),
        });
      }

      if (event.type === "tool_execution_end") {
        const text = contentToText(event.result?.content);
        const displayIntent = displayIntentFromToolResult(
          event.result?.details
        );
        run.emit({
          type: "tool-end",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          output: displayIntent
            ? text || "Opened in the preview pane."
            : previewToolOutput(event.result?.details ?? text),
          displayIntent: displayIntent ?? undefined,
          errorText: event.isError ? text || "Tool failed" : undefined,
          isError: event.isError,
        });
        if (displayIntent && !event.isError) {
          run.emit({
            type: "workspace-display",
            intent: displayIntent,
          });
        }
      }
    });

    await piSession.sendUserMessage(
      await buildPiUserContent(requestBody.message)
    );

    await createWorkspaceCheckpoint({
      roots: workspaceRoots,
      conversationPath: chat.workspacePath,
      checkpointId: currentCheckpointId(piSession.sessionManager),
    });

    await persistWorkspaceChanges();

    if (shouldGenerateMetadata) {
      const metadata = await generateConversationMetadata({
        chatId: chat.id,
        entries: piSession.sessionManager.getBranch(),
        selectedModelId: selectedChatModel,
        signal: run.abortSignal,
      });
      if (metadata) {
        await updateChatMetadataById({
          chatId: chat.id,
          title: metadata.title,
          summary: metadata.summary,
        });
        run.emit({
          type: "title",
          title: metadata.title,
        });
      }
    }

    run.emit({
      type: "done",
      sessionFilePath: piSession.sessionFile,
      messages: piEntriesToChatMessages(
        piSession.sessionManager.getBranch(),
        chat.id
      ),
    });
  } catch (error) {
    if (run.isStopRequested) {
      run.emit({ type: "stopped" });
      return;
    }

    run.emit({
      type: "error",
      message: error instanceof Error ? error.message : "Pi failed to respond.",
    });
  } finally {
    unsubscribe?.();
    run.abortSignal.removeEventListener("abort", abort);
    piSession?.dispose();
  }
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    requestBody = postRequestBodySchema.parse(await request.json());
  } catch (_) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  await checkIpRateLimit(ipAddress(request));

  const selectedChatModel = allowedModelIds.has(requestBody.selectedChatModel)
    ? requestBody.selectedChatModel
    : DEFAULT_CHAT_MODEL;
  const assistantMessageId = requestBody.assistantMessageId ?? generateUUID();

  const run = startChatRun({
    assistantMessageId,
    chatId: requestBody.id,
    initialMessages: createSubmittedMessages({
      assistantMessageId,
      branchFromEntryId: requestBody.branchFromEntryId,
      existingMessages: [],
      message: requestBody.message,
    }),
    producer: (activeRun) =>
      producePiChatRun({
        assistantMessageId,
        requestBody,
        run: activeRun,
        selectedChatModel,
      }),
  });

  if (!run) {
    return Response.json(
      {
        code: "conversation_busy",
        message: "Conversation is already running.",
      },
      { status: 409 }
    );
  }

  return new Response(run.toReadableStream(), {
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (!chat) {
    return new ChatbotError("not_found:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  if (deletedChat) {
    await moveWorkspaceToTrash(deletedChat.workspacePath);
  }

  return Response.json(deletedChat, { status: 200 });
}
