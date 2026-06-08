import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  ensureLocalNetworkUser,
  getChatById,
  getChatMcpServerOverrides,
  getProjectMcpServers,
  setChatMcpServerOverrides,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { readUserMcpCatalog } from "@/lib/pi/mcp-config";

const overrideStateSchema = z.enum(["inherit", "enabled", "disabled"]);
const updateChatMcpSchema = z.object({
  overrides: z.record(z.string(), overrideStateSchema),
});

async function getAuthorizedChat(id: string) {
  const localUser = await ensureLocalNetworkUser();
  const chat = await getChatById({ id });

  if (!chat || chat.userId !== localUser.id) {
    throw new ChatbotError("not_found:chat");
  }

  return { chat, localUser };
}

function toResponse({
  catalogServers,
  overrides,
  projectDefaults,
}: {
  catalogServers: Awaited<ReturnType<typeof readUserMcpCatalog>>["servers"];
  overrides: Array<{ serverId: string; state: string }>;
  projectDefaults: Array<{ serverId: string; enabled: boolean }>;
}) {
  const overrideByServerId = new Map(
    overrides.map((override) => [override.serverId, override.state])
  );
  const projectDefaultByServerId = new Map(
    projectDefaults.map((server) => [server.serverId, server.enabled])
  );

  return {
    servers: catalogServers.map((server) => {
      const defaultEnabled = projectDefaultByServerId.get(server.id) ?? false;
      const override = overrideByServerId.get(server.id) ?? "inherit";
      const effectiveEnabled =
        override === "inherit" ? defaultEnabled : override === "enabled";

      return {
        ...server,
        defaultEnabled,
        effectiveEnabled,
        override,
      };
    }),
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
    const { chat, localUser } = await getAuthorizedChat(id);
    const [catalog, projectDefaults, overrides] = await Promise.all([
      readUserMcpCatalog(localUser.id),
      chat.projectId ? getProjectMcpServers({ projectId: chat.projectId }) : [],
      getChatMcpServerOverrides({ chatId: chat.id }),
    ]);

    return Response.json(
      toResponse({
        catalogServers: catalog.servers,
        overrides,
        projectDefaults,
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

  let overrides: Record<string, z.infer<typeof overrideStateSchema>>;

  try {
    overrides = updateChatMcpSchema.parse(await request.json()).overrides;
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { id } = await params;
    const { chat, localUser } = await getAuthorizedChat(id);
    const catalog = await readUserMcpCatalog(localUser.id);
    const knownServerIds = new Set(catalog.servers.map((server) => server.id));
    const savedOverrides = await setChatMcpServerOverrides({
      chatId: chat.id,
      overrides: Object.entries(overrides)
        .filter(([serverId]) => knownServerIds.has(serverId))
        .map(([serverId, state]) => ({ serverId, state })),
    });
    const projectDefaults = chat.projectId
      ? await getProjectMcpServers({ projectId: chat.projectId })
      : [];

    return Response.json(
      toResponse({
        catalogServers: catalog.servers,
        overrides: savedOverrides,
        projectDefaults,
      })
    );
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    throw error;
  }
}
