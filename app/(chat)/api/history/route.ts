import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  deleteAllChats,
  ensureLocalNetworkUser,
  getAllProjects,
  getChatsByProjectId,
  getProjectById,
  saveProject,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import {
  ensureProjectWorkspace,
  getProjectWorkspacePath,
  moveWorkspaceToTrash,
} from "@/lib/pi/workspace";
import { generateUUID } from "@/lib/utils";

async function getOrCreateProjectId(requestedProjectId: string | null) {
  if (requestedProjectId) {
    const project = await getProjectById({ id: requestedProjectId });
    if (!project) {
      throw new ChatbotError("not_found:chat");
    }
    return project.id;
  }

  const projects = await getAllProjects();
  if (projects[0]) {
    return projects[0].id;
  }

  const localUser = await ensureLocalNetworkUser();
  const id = generateUUID();
  await ensureProjectWorkspace({ userId: localUser.id, projectId: id });
  const project = await saveProject({
    id,
    userId: localUser.id,
    name: "General",
    workspacePath: getProjectWorkspacePath(localUser.id, id),
  });
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

  const chats = await getChatsByProjectId({
    projectId,
    limit,
    startingAfter,
    endingBefore,
  });

  return Response.json({ ...chats, projectId });
}

export async function DELETE() {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const result = await deleteAllChats();

  await Promise.all(
    result.chats.map((chat) => moveWorkspaceToTrash(chat.workspacePath))
  );

  return Response.json({ deletedCount: result.deletedCount }, { status: 200 });
}
