import "server-only";

import { and, asc, desc, eq, gt, lt, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ArtifactKind } from "@/components/chat/artifact";
import { ChatbotError } from "../errors";
import { generateUUID } from "../utils";
import {
  type Chat,
  chat,
  type DBMessage,
  type Document,
  project,
  type Suggestion,
  type User,
  user,
  type Vote,
} from "./schema";
import { generateHashedPassword } from "./utils";

const client = postgres(process.env.POSTGRES_URL ?? "");
const db = drizzle(client);

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

export async function createGuestUser() {
  const email = `guest-${Date.now()}`;
  const password = generateHashedPassword(generateUUID());

  try {
    return await db.insert(user).values({ email, password }).returning({
      id: user.id,
      email: user.email,
    });
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to create guest user"
    );
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
  workspacePath,
  piSessionFilePath,
}: {
  id: string;
  userId: string;
  projectId: string;
  title: string;
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
