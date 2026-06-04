import { SessionManager } from "@mariozechner/pi-coding-agent";
import { z } from "zod";
import { saveChat } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import {
  ensureConversationWorkspace,
  getConversationWorkspacePath,
} from "@/lib/pi/workspace";
import { getAuthorizedWorkspace } from "@/lib/pi/workspace-auth";
import { restoreWorkspaceCheckpoint } from "@/lib/pi/workspace-checkpoints";
import {
  getWorkspaceRoots,
  writeWorkspaceChanges,
} from "@/lib/pi/workspace-files";
import { generateUUID } from "@/lib/utils";

const branchSchema = z.object({
  chatId: z.string().uuid(),
  entryId: z.string().min(1),
  restoreCheckpointId: z.string().min(1).optional(),
  confirmedRestore: z.boolean().optional(),
});

export async function POST(request: Request) {
  let body: z.infer<typeof branchSchema>;

  try {
    body = branchSchema.parse(await request.json());
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { chat: sourceChat } = await getAuthorizedWorkspace(body.chatId);
    const newChatId = generateUUID();
    const workspace = await ensureConversationWorkspace({
      userId: sourceChat.userId,
      projectId: sourceChat.projectId,
      conversationId: newChatId,
    });

    const seedManager = SessionManager.create(workspace.conversationPath);
    const branchManager = SessionManager.open(
      sourceChat.piSessionFilePath,
      seedManager.getSessionDir(),
      workspace.conversationPath
    );
    const sessionFilePath = branchManager.createBranchedSession(body.entryId);

    if (!sessionFilePath) {
      return new ChatbotError("bad_request:api").toResponse();
    }

    const newChat = await saveChat({
      id: newChatId,
      userId: sourceChat.userId,
      projectId: sourceChat.projectId,
      title: `${sourceChat.title} (branch)`,
      summary: sourceChat.summary,
      workspacePath: getConversationWorkspacePath({
        userId: sourceChat.userId,
        projectId: sourceChat.projectId,
        conversationId: newChatId,
      }),
      piSessionFilePath: sessionFilePath,
    });

    if (body.restoreCheckpointId && body.confirmedRestore) {
      const result = await restoreWorkspaceCheckpoint({
        sourceConversationPath: sourceChat.workspacePath,
        targetRoots: getWorkspaceRoots(newChat),
        checkpointId: body.restoreCheckpointId,
      });

      if (!result.missingCheckpoint) {
        await writeWorkspaceChanges({
          conversationPath: newChat.workspacePath,
          changes: result.changes,
        });
      }
    }

    return Response.json({
      chatId: newChat.id,
      url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${newChat.id}`,
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
