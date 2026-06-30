import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  ensureLocalNetworkUser,
  getProjectsByUserId,
  saveProject,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import {
  ensureProjectWorkspace,
  getProjectWorkspacePath,
} from "@/lib/pi/workspace";
import { generateUUID } from "@/lib/utils";

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const localUser = await ensureLocalNetworkUser();
  const projects = await getProjectsByUserId({ userId: localUser.id });

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

  const localUser = await ensureLocalNetworkUser();
  const id = generateUUID();
  await ensureProjectWorkspace({ userId: localUser.id, projectId: id });

  const savedProject = await saveProject({
    id,
    userId: localUser.id,
    name,
    workspacePath: getProjectWorkspacePath(localUser.id, id),
  });

  return Response.json({ project: savedProject }, { status: 201 });
}
