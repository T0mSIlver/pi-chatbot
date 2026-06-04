import { z } from "zod";
import { ChatbotError } from "@/lib/errors";
import { getAuthorizedWorkspace } from "@/lib/pi/workspace-auth";
import { restoreWorkspaceCheckpoint } from "@/lib/pi/workspace-checkpoints";
import { writeWorkspaceChanges } from "@/lib/pi/workspace-files";

const restoreSchema = z.object({
  chatId: z.string().uuid(),
  checkpointId: z.string().min(1),
  confirmed: z.literal(true),
});

export async function POST(request: Request) {
  let body: z.infer<typeof restoreSchema>;

  try {
    body = restoreSchema.parse(await request.json());
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { chat, roots } = await getAuthorizedWorkspace(body.chatId);
    const result = await restoreWorkspaceCheckpoint({
      sourceConversationPath: chat.workspacePath,
      targetRoots: roots,
      checkpointId: body.checkpointId,
    });

    if (!result.missingCheckpoint) {
      await writeWorkspaceChanges({
        conversationPath: chat.workspacePath,
        changes: result.changes,
      });
    }

    return Response.json(result);
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
