import { auth } from "@/app/(auth)/auth";
import { getChatById } from "@/lib/db/queries";
import { readPiSessionMessages } from "@/lib/pi/jsonl";

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
    });
  }

  if (!session?.user) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const messages = await readPiSessionMessages(
    chat.piSessionFilePath,
    chat.id,
    chat.workspacePath
  );

  return Response.json({
    messages,
    projectId: chat.projectId,
    userId: chat.userId,
    isReadonly: false,
  });
}
