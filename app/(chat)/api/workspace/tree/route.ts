import { ChatbotError } from "@/lib/errors";
import { getAuthorizedWorkspace } from "@/lib/pi/workspace-auth";
import { buildWorkspaceTree } from "@/lib/pi/workspace-files";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    const { roots } = await getAuthorizedWorkspace(searchParams.get("chatId"));
    return Response.json({
      roots: await buildWorkspaceTree(roots),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    return new ChatbotError("bad_request:api").toResponse();
  }
}
