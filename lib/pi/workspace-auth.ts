import "server-only";

import { auth } from "@/app/(auth)/auth";
import { getChatById } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { getWorkspaceRoots } from "./workspace-files";

export async function getAuthorizedWorkspace(chatId: string | null) {
  if (!chatId) {
    throw new ChatbotError("bad_request:api");
  }

  const [session, chat] = await Promise.all([
    auth(),
    getChatById({ id: chatId }),
  ]);

  if (!session?.user) {
    throw new ChatbotError("unauthorized:chat");
  }

  if (!chat) {
    throw new ChatbotError("not_found:chat");
  }

  if (chat.userId !== session.user.id) {
    throw new ChatbotError("forbidden:chat");
  }

  return {
    chat,
    roots: getWorkspaceRoots(chat),
  };
}
