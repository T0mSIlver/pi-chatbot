import { ChatbotError } from "@/lib/errors";
import { readProviderCaptures } from "@/lib/pi/provider-captures";
import { getAuthorizedWorkspace } from "@/lib/pi/workspace-auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { chat } = await getAuthorizedWorkspace(id);
    return Response.json({
      captures: await readProviderCaptures(chat.workspacePath),
    });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    return new ChatbotError(
      "bad_request:api",
      error instanceof Error ? error.message : undefined
    ).toResponse();
  }
}
