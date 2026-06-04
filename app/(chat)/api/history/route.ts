import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  ensureLocalNetworkProject,
  getAllChats,
  getChatsByProjectId,
  getProjectById,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

async function getOrCreateProjectId(requestedProjectId: string | null) {
  if (requestedProjectId) {
    const project = await getProjectById({ id: requestedProjectId });
    if (!project) {
      throw new ChatbotError("not_found:chat");
    }
    return project.id;
  }

  const project = await ensureLocalNetworkProject();
  return project.id;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const limit = Math.min(
    Math.max(Number.parseInt(searchParams.get("limit") || "10", 10), 1),
    50
  );
  const startingAfter = searchParams.get("starting_after");
  const endingBefore = searchParams.get("ending_before");
  const requestedProjectId = searchParams.get("projectId");

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

  let projectId: string;
  try {
    projectId = await getOrCreateProjectId(requestedProjectId);
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    throw error;
  }

  const chats = requestedProjectId
    ? await getChatsByProjectId({
        projectId,
        limit,
        startingAfter,
        endingBefore,
      })
    : await getAllChats({
        limit,
        startingAfter,
        endingBefore,
      });

  return Response.json({ ...chats, projectId });
}

export function DELETE() {
  return new ChatbotError(
    "bad_request:api",
    "Bulk chat deletion is disabled for shared local history."
  ).toResponse();
}
