import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  ensureLocalNetworkUser,
  getChatsByProjectId,
  getProjectById,
  getStandaloneChatsByUserId,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const limit = Math.min(
    Math.max(Number.parseInt(searchParams.get("limit") || "10", 10), 1),
    50
  );
  const startingAfter = searchParams.get("starting_after");
  const endingBefore = searchParams.get("ending_before");
  const requestedProjectId = searchParams.get("projectId");
  const requestedScope = searchParams.get("scope");

  if (startingAfter && endingBefore) {
    return new ChatbotError(
      "bad_request:api",
      "Only one of starting_after or ending_before can be provided."
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const localUser = await ensureLocalNetworkUser();

  if (requestedProjectId) {
    const project = await getProjectById({ id: requestedProjectId });

    if (!project || project.userId !== localUser.id) {
      return new ChatbotError("not_found:chat").toResponse();
    }

    const chats = await getChatsByProjectId({
      projectId: project.id,
      limit,
      startingAfter,
      endingBefore,
    });

    return Response.json({
      ...chats,
      projectId: project.id,
      scope: "project",
    });
  }

  if (requestedScope && requestedScope !== "standalone") {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const chats = await getStandaloneChatsByUserId({
    userId: localUser.id,
    limit,
    startingAfter,
    endingBefore,
  });

  return Response.json({ ...chats, projectId: null, scope: "standalone" });
}

export function DELETE() {
  return new ChatbotError(
    "bad_request:api",
    "Bulk chat deletion is disabled for shared local history."
  ).toResponse();
}
