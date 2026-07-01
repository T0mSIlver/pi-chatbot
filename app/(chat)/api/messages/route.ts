import { auth } from "@/app/(auth)/auth";
import {
  getChatById,
  getLatestRunByChatId,
  markRunInterrupted,
} from "@/lib/db/queries";
import type { Chat, Stream } from "@/lib/db/schema";
import { getChatRun } from "@/lib/pi/chat-runs";
import { readPiSessionMessages } from "@/lib/pi/jsonl";
import type { ChatMessage } from "@/lib/types";

function missingTranscriptMessage(chat: Chat): ChatMessage {
  return {
    id: `missing-transcript-${chat.id}`,
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "This conversation exists in the database, but its transcript file is not available on this machine.",
      },
    ],
    metadata: {
      createdAt: chat.createdAt.toISOString(),
    },
  };
}

// Additive only: surface what an abnormally-ended run produced without ever
// reordering or rewriting the JSONL transcript (which is the source of truth).
function withInterruptedPartial(
  messages: ChatMessage[],
  run: Stream
): ChatMessage[] {
  const assistantId = run.assistantMessageId;

  // If the assistant answer already made it into the transcript, just tag it so
  // the UI can mark the turn as interrupted.
  if (assistantId) {
    const index = messages.findIndex((message) => message.id === assistantId);
    if (index >= 0) {
      const existing = messages[index];
      const tagged: ChatMessage = {
        ...existing,
        metadata: {
          ...existing.metadata,
          createdAt: existing.metadata?.createdAt ?? new Date().toISOString(),
          interrupted: true,
        },
      };
      return [
        ...messages.slice(0, index),
        tagged,
        ...messages.slice(index + 1),
      ];
    }
  }

  // Otherwise append the checkpointed partial — but only when the transcript
  // already ends with the originating user turn, so we never orphan it.
  const partial = run.partial as ChatMessage | null;
  if (
    partial?.role === "assistant" &&
    Array.isArray(partial.parts) &&
    partial.parts.length > 0 &&
    messages.at(-1)?.role === "user"
  ) {
    return [
      ...messages,
      {
        ...partial,
        metadata: {
          ...partial.metadata,
          createdAt: partial.metadata?.createdAt ?? new Date().toISOString(),
          interrupted: true,
        },
      },
    ];
  }

  return messages;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  if (!chatId) {
    return Response.json({ error: "chatId required" }, { status: 400 });
  }

  const [session, chat] = await Promise.all([
    auth(),
    getChatById({ id: chatId }),
  ]);

  if (!chat) {
    return Response.json({
      messages: [],
      userId: null,
      isReadonly: false,
      activeRun: null,
      lastRun: null,
    });
  }

  if (!session?.user) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  // Presence. getChatRun returns a run that is active OR recently terminal
  // (still cached). If ANY run is cached for this chat, its producer lived in
  // THIS process, so a DB row that still reads 'active' is just a terminal write
  // in flight — NOT a dead producer. Only when nothing is cached do we consult
  // the durable record for a producer that died (restart / >retention window).
  const cached = getChatRun(chatId);
  let activeRun: { id: string; assistantMessageId: string } | null = null;
  let lastRun: Stream | null = null;

  if (cached?.isActive) {
    activeRun = {
      id: cached.runId,
      assistantMessageId: cached.assistantMessageId,
    };
  } else if (!cached) {
    lastRun = await getLatestRunByChatId({ chatId });
    if (lastRun?.status === "active") {
      // DB says active but no process holds the run → the producer died.
      await markRunInterrupted({ id: lastRun.id });
      lastRun = { ...lastRun, status: "interrupted" };
    }
  }
  // cached && !isActive → the run just finished in this process; the fresh
  // transcript is authoritative and the terminal write is in flight, so leave
  // lastRun null and never mislabel a just-completed answer as interrupted.

  let messages = await readPiSessionMessages(
    chat.piSessionFilePath,
    chat.id,
    chat.workspacePath
  );

  if (
    lastRun &&
    (lastRun.status === "interrupted" || lastRun.status === "error")
  ) {
    messages = withInterruptedPartial(messages, lastRun);
  }

  const safeMessages =
    messages.length > 0 ? messages : [missingTranscriptMessage(chat)];

  return Response.json({
    messages: safeMessages,
    projectId: chat.projectId,
    userId: chat.userId,
    isReadonly: false,
    activeRun,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          status: lastRun.status,
          error: lastRun.error,
          finishedAt: lastRun.finishedAt,
        }
      : null,
  });
}
