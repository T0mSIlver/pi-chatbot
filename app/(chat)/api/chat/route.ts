import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { ipAddress } from "@vercel/functions";
import { auth } from "@/app/(auth)/auth";
import { allowedModelIds, DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { isTestEnvironment } from "@/lib/constants";
import {
  deleteChatById,
  getChatById,
  getProjectById,
  getProjectsByUserId,
  saveChat,
  saveProject,
  updateChatMetadataById,
  updateChatPiSessionFilePathById,
} from "@/lib/db/queries";
import type { Chat } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import { generateConversationMetadata } from "@/lib/pi/conversation-metadata";
import type { PiStreamEvent } from "@/lib/pi/events";
import { piEntriesToChatMessages } from "@/lib/pi/jsonl";
import { createPiSdkSession } from "@/lib/pi/session";
import {
  ensureConversationWorkspace,
  ensureProjectWorkspace,
  getConversationWorkspacePath,
  getProjectWorkspacePath,
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
import { generateUUID, getTextFromMessage } from "@/lib/utils";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 300;

declare global {
  // eslint-disable-next-line no-var
  var __piConversationLocks: Set<string> | undefined;
}

const locks = globalThis.__piConversationLocks ?? new Set<string>();
globalThis.__piConversationLocks = locks;

function writeNdjson(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: PiStreamEvent
) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

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

async function getOrCreateProject(userId: string, requestedProjectId?: string) {
  if (requestedProjectId) {
    const project = await getProjectById({ id: requestedProjectId });
    if (!project) {
      throw new ChatbotError("not_found:chat");
    }
    if (project.userId !== userId) {
      throw new ChatbotError("forbidden:chat");
    }
    await ensureProjectWorkspace({ userId, projectId: project.id });
    return project;
  }

  const projects = await getProjectsByUserId({ userId });
  if (projects[0]) {
    await ensureProjectWorkspace({ userId, projectId: projects[0].id });
    return projects[0];
  }

  const id = generateUUID();
  await ensureProjectWorkspace({ userId, projectId: id });
  return saveProject({
    id,
    userId,
    name: "General",
    workspacePath: getProjectWorkspacePath(userId, id),
  });
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
  chat,
  message,
  branchFromEntryId,
  controller,
  encoder,
}: {
  chat: Chat;
  message: PostRequestBody["message"];
  branchFromEntryId?: string | null;
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
}) {
  const sessionFilePath = chat.piSessionFilePath;
  const timestamp = new Date().toISOString();
  const text = "This is a mocked Pi response for tests.";
  const userText = getTextFromMessage(message);
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
    writeNdjson(controller, encoder, {
      type: "thinking-delta",
      delta: "I should inspect the README first.",
    });
  }
  writeNdjson(controller, encoder, {
    type: "tool-start",
    toolCallId: "mock-tool",
    toolName: "read",
    input: { path: "README.md" },
  });
  writeNdjson(controller, encoder, {
    type: "tool-end",
    toolCallId: "mock-tool",
    toolName: "read",
    output: "mock tool output",
    isError: false,
  });
  if (shouldMockInterleavedThinking) {
    writeNdjson(controller, encoder, {
      type: "thinking-delta",
      delta: "The README result is enough context.",
    });
  } else {
    writeNdjson(controller, encoder, {
      type: "tool-start",
      toolCallId: "mock-showcase-file",
      toolName: "showcase_file",
      input: { path: "mock-output.md", mode: "markdown" },
    });
    writeNdjson(controller, encoder, {
      type: "tool-end",
      toolCallId: "mock-showcase-file",
      toolName: "showcase_file",
      output: "Opened conversation:mock-output.md in the preview pane.",
      displayIntent,
      isError: false,
    });
    writeNdjson(controller, encoder, {
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

  writeNdjson(controller, encoder, { type: "text-delta", delta: text });
  writeNdjson(controller, encoder, {
    type: "done",
    sessionFilePath,
    messages: piEntriesToChatMessages(sessionManager.getBranch(), chat.id),
  });

  return sessionManager.getBranch();
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

  if (locks.has(requestBody.id)) {
    return Response.json(
      {
        code: "conversation_busy",
        message: "Conversation is already running.",
      },
      { status: 409 }
    );
  }

  await checkIpRateLimit(ipAddress(request));

  const selectedChatModel = allowedModelIds.has(requestBody.selectedChatModel)
    ? requestBody.selectedChatModel
    : DEFAULT_CHAT_MODEL;

  locks.add(requestBody.id);

  try {
    let chat = await getChatById({ id: requestBody.id });
    let shouldGenerateMetadata = false;

    if (chat) {
      if (chat.userId !== session.user.id) {
        locks.delete(requestBody.id);
        return new ChatbotError("forbidden:chat").toResponse();
      }
    } else {
      const project = await getOrCreateProject(
        session.user.id,
        requestBody.projectId
      );
      const workspace = await ensureConversationWorkspace({
        userId: session.user.id,
        projectId: project.id,
        conversationId: requestBody.id,
      });

      shouldGenerateMetadata = true;

      if (isTestEnvironment) {
        chat = await createConversationMetadata({
          id: requestBody.id,
          userId: session.user.id,
          projectId: project.id,
          title: "New conversation",
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
          userId: session.user.id,
          projectId: project.id,
          title: "New conversation",
          piSessionFilePath: piSession.sessionFile ?? "",
        });
        piSession.dispose();
      }
    }

    if (!chat) {
      locks.delete(requestBody.id);
      return new ChatbotError("bad_request:api").toResponse();
    }

    const workspaceRoots = getWorkspaceRoots(chat);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        let piSession: Awaited<ReturnType<typeof createPiSdkSession>> | null =
          null;
        let unsubscribe: (() => void) | null = null;
        const abort = () => {
          piSession?.abort().catch(() => undefined);
        };

        try {
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
              chat,
              message: requestBody.message,
              branchFromEntryId: requestBody.branchFromEntryId,
              controller,
              encoder,
            });
            await persistWorkspaceChanges();
            if (shouldGenerateMetadata) {
              const metadata = await generateConversationMetadata({
                entries,
                selectedModelId: selectedChatModel,
                signal: request.signal,
              });
              if (metadata) {
                await updateChatMetadataById({
                  chatId: chat.id,
                  title: metadata.title,
                  summary: metadata.summary,
                });
                writeNdjson(controller, encoder, {
                  type: "title",
                  title: metadata.title,
                });
              }
            }
            controller.close();
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

          request.signal.addEventListener("abort", abort, { once: true });

          const streamingToolCalls = new Map<string, StreamingToolCall>();

          unsubscribe = piSession.subscribe((event) => {
            if (
              event.type === "message_update" &&
              event.assistantMessageEvent.type === "text_delta"
            ) {
              writeNdjson(controller, encoder, {
                type: "text-delta",
                delta: event.assistantMessageEvent.delta,
              });
            }

            if (
              event.type === "message_update" &&
              event.assistantMessageEvent.type === "thinking_delta"
            ) {
              writeNdjson(controller, encoder, {
                type: "thinking-delta",
                delta: event.assistantMessageEvent.delta,
              });
            }

            if (
              event.type === "message_update" &&
              event.assistantMessageEvent.type === "toolcall_start"
            ) {
              const block = getAssistantToolCallBlock(
                event.assistantMessageEvent
              );
              if (block) {
                const toolCallId = block.id ?? `tool-${block.contentIndex}`;
                const toolName = block.name ?? "tool";
                streamingToolCalls.set(String(block.contentIndex), {
                  toolCallId,
                  toolName,
                  inputText: "",
                });
                writeNdjson(controller, encoder, {
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
              const block = getAssistantToolCallBlock(
                event.assistantMessageEvent
              );
              if (block) {
                const key = String(block.contentIndex);
                const existing = streamingToolCalls.get(key);
                const toolCallId =
                  existing?.toolCallId ??
                  block.id ??
                  `tool-${block.contentIndex}`;
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
                writeNdjson(controller, encoder, {
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
              const block = getAssistantToolCallBlock(
                event.assistantMessageEvent
              );
              if (block) {
                streamingToolCalls.delete(String(block.contentIndex));
              }
            }

            if (event.type === "tool_execution_start") {
              writeNdjson(controller, encoder, {
                type: "tool-start",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                input: event.args,
              });
            }

            if (event.type === "tool_execution_update") {
              writeNdjson(controller, encoder, {
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
              writeNdjson(controller, encoder, {
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
                writeNdjson(controller, encoder, {
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
              entries: piSession.sessionManager.getBranch(),
              selectedModelId: selectedChatModel,
              signal: request.signal,
            });
            if (metadata) {
              await updateChatMetadataById({
                chatId: chat.id,
                title: metadata.title,
                summary: metadata.summary,
              });
              writeNdjson(controller, encoder, {
                type: "title",
                title: metadata.title,
              });
            }
          }

          writeNdjson(controller, encoder, {
            type: "done",
            sessionFilePath: piSession.sessionFile,
            messages: piEntriesToChatMessages(
              piSession.sessionManager.getBranch(),
              chat.id
            ),
          });
          controller.close();
        } catch (error) {
          writeNdjson(controller, encoder, {
            type: "error",
            message:
              error instanceof Error ? error.message : "Pi failed to respond.",
          });
          controller.close();
        } finally {
          unsubscribe?.();
          request.signal.removeEventListener("abort", abort);
          piSession?.dispose();
          locks.delete(requestBody.id);
        }
      },
      cancel() {
        locks.delete(requestBody.id);
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "application/x-ndjson; charset=utf-8",
      },
    });
  } catch (error) {
    locks.delete(requestBody.id);

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Unhandled error in Pi chat API:", error);
    return new ChatbotError("offline:chat").toResponse();
  }
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

  if (chat.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  if (deletedChat) {
    await moveWorkspaceToTrash(deletedChat.workspacePath);
  }

  return Response.json(deletedChat, { status: 200 });
}
