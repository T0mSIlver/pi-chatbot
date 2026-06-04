import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  deleteProjectById,
  getProjectById,
  updateProjectById,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { moveWorkspaceToTrash } from "@/lib/pi/workspace";

const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const { id } = await params;
  const selectedProject = await getProjectById({ id });

  if (!selectedProject) {
    return new ChatbotError("not_found:chat").toResponse();
  }

  let name: string;

  try {
    name = updateProjectSchema.parse(await request.json()).name;
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const project = await updateProjectById({ id, name });

  return Response.json({ project });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const { id } = await params;
  const selectedProject = await getProjectById({ id });

  if (!selectedProject) {
    return new ChatbotError("not_found:chat").toResponse();
  }

  const deleted = await deleteProjectById({ id });
  await moveWorkspaceToTrash(selectedProject.workspacePath);

  return Response.json(deleted);
}
