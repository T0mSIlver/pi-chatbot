import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { getProjectsByUserId, saveProject } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import {
  ensureProjectWorkspace,
  getProjectWorkspacePath,
} from "@/lib/pi/workspace";
import { generateUUID } from "@/lib/utils";

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

async function createDefaultProject(userId: string) {
  const id = generateUUID();
  await ensureProjectWorkspace({ userId, projectId: id });
  return saveProject({
    id,
    userId,
    name: "General",
    workspacePath: getProjectWorkspacePath(userId, id),
  });
}

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  let projects = await getProjectsByUserId({ userId: session.user.id });

  if (projects.length === 0) {
    const defaultProject = await createDefaultProject(session.user.id);
    projects = [defaultProject];
  }

  return Response.json({ projects });
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  let name: string;

  try {
    name = createProjectSchema.parse(await request.json()).name;
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const id = generateUUID();
  await ensureProjectWorkspace({ userId: session.user.id, projectId: id });

  const savedProject = await saveProject({
    id,
    userId: session.user.id,
    name,
    workspacePath: getProjectWorkspacePath(session.user.id, id),
  });

  return Response.json({ project: savedProject }, { status: 201 });
}
