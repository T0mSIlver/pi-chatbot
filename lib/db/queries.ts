import "server-only";

import { and, asc, desc, eq, gt, isNull, lt, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ArtifactKind } from "@/components/chat/artifact";
import {
  LOCAL_NETWORK_PROJECT_ID,
  LOCAL_NETWORK_PROJECT_NAME,
  LOCAL_NETWORK_USER_EMAIL,
  LOCAL_NETWORK_USER_ID,
  LOCAL_NETWORK_USER_NAME,
} from "@/lib/local-network-user";
import {
  ensureProjectWorkspace,
  getProjectWorkspacePath,
} from "@/lib/pi/workspace";
import { ChatbotError } from "../errors";
import {
  type Chat,
  chat,
  chatMcpServerOverride,
  type DBMessage,
  type Document,
  mcpConfig,
  project,
  projectMcpServer,
  type Suggestion,
  type User,
  user,
  type Vote,
} from "./schema";
import { generateHashedPassword } from "./utils";

const client = postgres(process.env.POSTGRES_URL ?? "");
const db = drizzle(client);
const DEFAULT_MCP_CONFIG_JSON = '{\n  "mcpServers": {}\n}';

export async function getUser(email: string): Promise<User[]> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get user by email"
    );
  }
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);

  try {
    return await db.insert(user).values({ email, password: hashedPassword });
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to create user");
  }
}

export async function ensureLocalNetworkUser() {
  try {
    const now = new Date();
    const [localUser] = await db
      .insert(user)
      .values({
        id: LOCAL_NETWORK_USER_ID,
        email: LOCAL_NETWORK_USER_EMAIL,
        name: LOCAL_NETWORK_USER_NAME,
        password: null,
        isAnonymous: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: user.id,
        set: {
          email: LOCAL_NETWORK_USER_EMAIL,
          name: LOCAL_NETWORK_USER_NAME,
          isAnonymous: true,
          updatedAt: now,
        },
      })
      .returning({
        id: user.id,
        email: user.email,
      });

    if (!localUser) {
      throw new Error("Local network user upsert returned no rows");
    }

    return localUser;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to ensure local network user"
    );
  }
}

export async function createGuestUser() {
  try {
    const localUser = await ensureLocalNetworkUser();
    return [{ id: localUser.id, email: localUser.email }];
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to create guest user"
    );
  }
}

export async function ensureLocalNetworkProject() {
  const localUser = await ensureLocalNetworkUser();
  const now = new Date();
  const workspacePath = getProjectWorkspacePath(
    localUser.id,
    LOCAL_NETWORK_PROJECT_ID
  );

  try {
    await ensureProjectWorkspace({
      userId: localUser.id,
      projectId: LOCAL_NETWORK_PROJECT_ID,
    });

    const [localProject] = await db
      .insert(project)
      .values({
        id: LOCAL_NETWORK_PROJECT_ID,
        createdAt: now,
        updatedAt: now,
        userId: localUser.id,
        name: LOCAL_NETWORK_PROJECT_NAME,
        workspacePath,
      })
      .onConflictDoUpdate({
        target: project.id,
        set: {
          name: LOCAL_NETWORK_PROJECT_NAME,
          userId: localUser.id,
          workspacePath,
          updatedAt: now,
        },
      })
      .returning();

    if (!localProject) {
      throw new Error("Local network project upsert returned no rows");
    }

    return localProject;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to ensure local network project"
    );
  }
}

export async function getAllProjects() {
  try {
    return await db.select().from(project).orderBy(asc(project.createdAt));
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to get projects");
  }
}

export async function getProjectsByUserId({ userId }: { userId: string }) {
  try {
    return await db
      .select()
      .from(project)
      .where(eq(project.userId, userId))
      .orderBy(asc(project.createdAt));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get projects by user id"
    );
  }
}

export async function getProjectById({ id }: { id: string }) {
  try {
    const [selectedProject] = await db
      .select()
      .from(project)
      .where(eq(project.id, id))
      .limit(1);
    return selectedProject ?? null;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get project by id"
    );
  }
}

export async function saveProject({
  id,
  userId,
  name,
  workspacePath,
}: {
  id: string;
  userId: string;
  name: string;
  workspacePath: string;
}) {
  try {
    const [savedProject] = await db
      .insert(project)
      .values({
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
        userId,
        name,
        workspacePath,
      })
      .returning();
    return savedProject;
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to save project");
  }
}

export async function updateProjectById({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  try {
    const [updatedProject] = await db
      .update(project)
      .set({ name, updatedAt: new Date() })
      .where(eq(project.id, id))
      .returning();
    return updatedProject ?? null;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update project by id"
    );
  }
}

export async function deleteProjectById({ id }: { id: string }) {
  try {
    const projectChats = await db
      .select()
      .from(chat)
      .where(eq(chat.projectId, id));

    const [deletedProject] = await db
      .delete(project)
      .where(eq(project.id, id))
      .returning();

    return { project: deletedProject ?? null, chats: projectChats };
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete project by id"
    );
  }
}

export async function saveChat({
  id,
  userId,
  projectId,
  title,
  summary,
  workspacePath,
  piSessionFilePath,
}: {
  id: string;
  userId: string;
  projectId: string | null;
  title: string;
  summary?: string | null;
  workspacePath: string;
  piSessionFilePath: string;
}) {
  try {
    const [savedChat] = await db
      .insert(chat)
      .values({
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
        userId,
        projectId,
        title,
        summary: summary ?? null,
        workspacePath,
        piSessionFilePath,
      })
      .returning();
    return savedChat;
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to save chat");
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    const [deletedChat] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return deletedChat ?? null;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete chat by id"
    );
  }
}

export async function deleteAllChats() {
  try {
    const deletedChats = await db.delete(chat).returning();

    return { deletedCount: deletedChats.length, chats: deletedChats };
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete all chats"
    );
  }
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  try {
    const deletedChats = await db
      .delete(chat)
      .where(eq(chat.userId, userId))
      .returning();

    return { deletedCount: deletedChats.length, chats: deletedChats };
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete all chats by user id"
    );
  }
}

export async function getAllChats({
  limit,
  startingAfter,
  endingBefore,
}: {
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<unknown>) =>
      db
        .select()
        .from(chat)
        .where(whereCondition)
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (_error) {
    if (_error instanceof ChatbotError) {
      throw _error;
    }
    throw new ChatbotError("bad_request:database", "Failed to get chats");
  }
}

export async function getChatsByProjectId({
  projectId,
  limit,
  startingAfter,
  endingBefore,
}: {
  projectId: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<unknown>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.projectId, projectId))
            : eq(chat.projectId, projectId)
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (_error) {
    if (_error instanceof ChatbotError) {
      throw _error;
    }
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get chats by project id"
    );
  }
}

export async function getStandaloneChatsByUserId({
  userId,
  limit,
  startingAfter,
  endingBefore,
}: {
  userId: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<unknown>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(
                whereCondition,
                eq(chat.userId, userId),
                isNull(chat.projectId)
              )
            : and(eq(chat.userId, userId), isNull(chat.projectId))
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (_error) {
    if (_error instanceof ChatbotError) {
      throw _error;
    }
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get standalone chats by user id"
    );
  }
}

export async function getChatsByUserId({
  id,
  projectId,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  projectId: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<unknown>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(
                whereCondition,
                eq(chat.userId, id),
                eq(chat.projectId, projectId)
              )
            : and(eq(chat.userId, id), eq(chat.projectId, projectId))
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (_error) {
    if (_error instanceof ChatbotError) {
      throw _error;
    }
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get chats by user id"
    );
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    return selectedChat ?? null;
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to get chat by id");
  }
}

export async function updateChatTitleById({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  try {
    return await db
      .update(chat)
      .set({ title, updatedAt: new Date() })
      .where(eq(chat.id, chatId));
  } catch (_error) {
    return;
  }
}

export async function updateChatMetadataById({
  chatId,
  title,
  summary,
}: {
  chatId: string;
  title: string;
  summary: string;
}) {
  try {
    const [updatedChat] = await db
      .update(chat)
      .set({ title, summary, updatedAt: new Date() })
      .where(eq(chat.id, chatId))
      .returning({
        id: chat.id,
        summary: chat.summary,
        title: chat.title,
      });

    if (!updatedChat) {
      console.warn("[conversation-metadata-db]", {
        chatId,
        event: "update_no_rows",
        summaryChars: summary.length,
        title,
      });
      return null;
    }

    console.info("[conversation-metadata-db]", {
      chatId,
      event: "update_ok",
      summaryChars: updatedChat.summary?.length ?? 0,
      title: updatedChat.title,
    });

    return updatedChat;
  } catch (error) {
    console.error("[conversation-metadata-db]", {
      chatId,
      error:
        error instanceof Error
          ? {
              message: error.message,
              name: error.name,
              stack: error.stack,
            }
          : { message: String(error) },
      event: "update_failed",
      summaryChars: summary.length,
      title,
    });
    return null;
  }
}

export async function updateChatPiSessionFilePathById({
  chatId,
  piSessionFilePath,
}: {
  chatId: string;
  piSessionFilePath: string;
}) {
  try {
    return await db
      .update(chat)
      .set({ piSessionFilePath, updatedAt: new Date() })
      .where(eq(chat.id, chatId));
  } catch (_error) {
    return;
  }
}

export async function getMcpConfigByUserId({ userId }: { userId: string }) {
  try {
    const [config] = await db
      .select()
      .from(mcpConfig)
      .where(eq(mcpConfig.userId, userId))
      .limit(1);

    return config ?? null;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get MCP config by user id"
    );
  }
}

export async function ensureMcpConfigByUserId({ userId }: { userId: string }) {
  try {
    const now = new Date();
    const [config] = await db
      .insert(mcpConfig)
      .values({
        userId,
        json: DEFAULT_MCP_CONFIG_JSON,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: mcpConfig.userId,
        set: { updatedAt: now },
      })
      .returning();

    if (!config) {
      throw new Error("MCP config upsert returned no rows");
    }

    return config;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to ensure MCP config by user id"
    );
  }
}

export async function upsertMcpConfigByUserId({
  userId,
  json,
}: {
  userId: string;
  json: string;
}) {
  try {
    const now = new Date();
    const [config] = await db
      .insert(mcpConfig)
      .values({
        userId,
        json,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: mcpConfig.userId,
        set: { json, updatedAt: now },
      })
      .returning();

    return config ?? null;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update MCP config by user id"
    );
  }
}

export async function getProjectMcpServers({
  projectId,
}: {
  projectId: string;
}) {
  try {
    return await db
      .select()
      .from(projectMcpServer)
      .where(eq(projectMcpServer.projectId, projectId))
      .orderBy(asc(projectMcpServer.serverId));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get project MCP servers"
    );
  }
}

export async function setProjectMcpServers({
  projectId,
  servers,
}: {
  projectId: string;
  servers: Array<{ serverId: string; enabled: boolean }>;
}) {
  try {
    await db
      .delete(projectMcpServer)
      .where(eq(projectMcpServer.projectId, projectId));

    if (servers.length > 0) {
      const now = new Date();
      await db.insert(projectMcpServer).values(
        servers.map((server) => ({
          projectId,
          serverId: server.serverId,
          enabled: server.enabled,
          createdAt: now,
          updatedAt: now,
        }))
      );
    }

    return getProjectMcpServers({ projectId });
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to set project MCP servers"
    );
  }
}

export async function getChatMcpServerOverrides({
  chatId,
}: {
  chatId: string;
}) {
  try {
    return await db
      .select()
      .from(chatMcpServerOverride)
      .where(eq(chatMcpServerOverride.chatId, chatId))
      .orderBy(asc(chatMcpServerOverride.serverId));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get chat MCP server overrides"
    );
  }
}

export async function setChatMcpServerOverrides({
  chatId,
  overrides,
}: {
  chatId: string;
  overrides: Array<{ serverId: string; state: string }>;
}) {
  try {
    await db
      .delete(chatMcpServerOverride)
      .where(eq(chatMcpServerOverride.chatId, chatId));

    const persisted = overrides.filter(
      (override) => override.state !== "inherit"
    );

    if (persisted.length > 0) {
      const now = new Date();
      await db.insert(chatMcpServerOverride).values(
        persisted.map((override) => ({
          chatId,
          serverId: override.serverId,
          state: override.state,
          createdAt: now,
          updatedAt: now,
        }))
      );
    }

    return getChatMcpServerOverrides({ chatId });
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to set chat MCP server overrides"
    );
  }
}

export function getMessageCountByUserId(_args: {
  id: string;
  differenceInHours: number;
}) {
  return 0;
}

// Legacy content persistence is intentionally disabled. Pi owns transcript JSONL
// and workspace state; these functions remain only so older artifact modules
// continue to type-check while v1 UI paths are removed.
export function saveMessages(_args: { messages: DBMessage[] }) {
  return;
}

export function updateMessage(_args: {
  id: string;
  parts: DBMessage["parts"];
}) {
  return;
}

export function getMessagesByChatId(_args: { id: string }): DBMessage[] {
  return [];
}

export function voteMessage(_args: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  return;
}

export function getVotesByChatId(_args: { id: string }): Vote[] {
  return [];
}

export function saveDocument(_args: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  throw new ChatbotError("bad_request:document", "Artifacts are disabled");
}

export function updateDocumentContent(_args: { id: string; content: string }) {
  throw new ChatbotError("bad_request:document", "Artifacts are disabled");
}

export function getDocumentsById(_args: { id: string }): Document[] {
  return [];
}

export function getDocumentById(_args: { id: string }): Document | undefined {
  return undefined;
}

export function deleteDocumentsByIdAfterTimestamp(_args: {
  id: string;
  timestamp: Date;
}): Document[] {
  return [];
}

export function saveSuggestions(_args: { suggestions: Suggestion[] }) {
  return;
}

export function getSuggestionsByDocumentId(_args: {
  documentId: string;
}): Suggestion[] {
  return [];
}

export function getMessageById(_args: { id: string }): DBMessage[] {
  return [];
}

export function deleteMessagesByChatIdAfterTimestamp(_args: {
  chatId: string;
  timestamp: Date;
}) {
  return;
}

export function updateChatVisibilityById(_args: {
  chatId: string;
  visibility: "private" | "public";
}) {
  return;
}

export function createStreamId(_args: { streamId: string; chatId: string }) {
  return;
}

export function getStreamIdsByChatId(_args: { chatId: string }): string[] {
  return [];
}
