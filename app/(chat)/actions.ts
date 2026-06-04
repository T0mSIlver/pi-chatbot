"use server";

import { cookies } from "next/headers";
import { auth } from "@/app/(auth)/auth";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { getChatById, updateChatVisibilityById } from "@/lib/db/queries";
import type { ChatMessage } from "@/lib/types";
import { getTextFromMessage } from "@/lib/utils";

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set("chat-model", model);
}

export async function generateTitleFromUserMessage({
  message,
}: {
  message: ChatMessage;
}) {
  await Promise.resolve();
  const text = getTextFromMessage(message) || "New conversation";
  return text
    .replace(/^[#*"\s]+/, "")
    .replace(/["]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  await Promise.resolve();
  throw new Error(`Message editing is disabled for Pi conversations (${id}).`);
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const chat = await getChatById({ id: chatId });
  if (!chat) {
    throw new Error("Unauthorized");
  }

  await updateChatVisibilityById({ chatId, visibility });
}
