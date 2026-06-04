import { z } from "zod";
import { ChatbotError } from "@/lib/errors";
import { getAuthorizedWorkspace } from "@/lib/pi/workspace-auth";
import { planWorkspaceRestore } from "@/lib/pi/workspace-checkpoints";

const restorePlanSchema = z.object({
  chatId: z.string().uuid(),
  checkpointId: z.string().min(1),
  destination: z.enum(["current", "new-chat"]).optional(),
});

export async function POST(request: Request) {
  let body: z.infer<typeof restorePlanSchema>;

  try {
    body = restorePlanSchema.parse(await request.json());
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { chat, roots } = await getAuthorizedWorkspace(body.chatId);
    return Response.json(
      await planWorkspaceRestore({
        sourceConversationPath: chat.workspacePath,
        targetRoots: roots,
        checkpointId: body.checkpointId,
        emptyConversation: body.destination === "new-chat",
      })
    );
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
