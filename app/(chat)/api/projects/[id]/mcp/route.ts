import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  ensureLocalNetworkUser,
  getProjectById,
  getProjectMcpServers,
  setProjectMcpServers,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { readUserMcpCatalog } from "@/lib/pi/mcp-config";

const updateProjectMcpSchema = z.object({
  servers: z.record(z.string(), z.boolean()),
});

async function getAuthorizedProject(id: string) {
  const localUser = await ensureLocalNetworkUser();
  const project = await getProjectById({ id });

  if (!project || project.userId !== localUser.id) {
    throw new ChatbotError("not_found:chat");
  }

  return { localUser, project };
}

function toResponse({
  savedServers,
  catalogServers,
}: {
  savedServers: Array<{ serverId: string; enabled: boolean }>;
  catalogServers: Awaited<ReturnType<typeof readUserMcpCatalog>>["servers"];
}) {
  const saved = new Map(
    savedServers.map((server) => [server.serverId, server.enabled])
  );

  return {
    servers: catalogServers.map((server) => ({
      ...server,
      enabled: saved.get(server.id) ?? false,
    })),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  try {
    const { id } = await params;
    const { localUser } = await getAuthorizedProject(id);
    const [catalog, savedServers] = await Promise.all([
      readUserMcpCatalog(localUser.id),
      getProjectMcpServers({ projectId: id }),
    ]);

    return Response.json(
      toResponse({
        savedServers,
        catalogServers: catalog.servers,
      })
    );
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    throw error;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  let servers: Record<string, boolean>;

  try {
    servers = updateProjectMcpSchema.parse(await request.json()).servers;
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { id } = await params;
    const { localUser } = await getAuthorizedProject(id);
    const catalog = await readUserMcpCatalog(localUser.id);
    const knownServerIds = new Set(catalog.servers.map((server) => server.id));
    const savedServers = await setProjectMcpServers({
      projectId: id,
      servers: Object.entries(servers)
        .filter(([serverId]) => knownServerIds.has(serverId))
        .map(([serverId, enabled]) => ({ serverId, enabled })),
    });

    return Response.json(
      toResponse({
        savedServers,
        catalogServers: catalog.servers,
      })
    );
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    throw error;
  }
}
