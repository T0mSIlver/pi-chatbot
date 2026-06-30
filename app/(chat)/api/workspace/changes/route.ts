import { ChatbotError } from "@/lib/errors";
import { getAuthorizedWorkspace } from "@/lib/pi/workspace-auth";
import { readWorkspaceChanges } from "@/lib/pi/workspace-files";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    const { chat } = await getAuthorizedWorkspace(searchParams.get("chatId"));
    return Response.json(await readWorkspaceChanges(chat.workspacePath));
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    return new ChatbotError("bad_request:api").toResponse();
  }
}
