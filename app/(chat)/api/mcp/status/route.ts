import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  ensureLocalNetworkUser,
  getChatById,
  getChatMcpServerOverrides,
  getProjectById,
  getProjectMcpServers,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { readUserMcpCatalog } from "@/lib/pi/mcp-config";
import { type McpProbeResult, probeMcpServer } from "@/lib/pi/mcp-status";

const statusRequestSchema = z.object({
  chatId: z.string().uuid().optional(),
  projectId: z.string().uuid().nullable().optional(),
  serverIds: z.array(z.string()).optional(),
});

type EnablementSource =
  | "catalog-only"
  | "conversation-disabled"
  | "conversation-enabled"
  | "not-enabled"
  | "project-enabled";

type ServerEnablement = {
  enabled: boolean;
  enablementSource: EnablementSource;
  effectiveEnabled: boolean;
};

const NOT_TESTED: McpProbeResult = {
  checkedAt: new Date(0).toISOString(),
  connectionState: "not-tested",
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
) {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const itemIndex = index;
      index += 1;
      results[itemIndex] = await mapper(items[itemIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );

  return results;
}

function resolveEnablement({
  override,
  projectEnabled,
  scoped,
}: {
  override?: string;
  projectEnabled: boolean;
  scoped: boolean;
}): ServerEnablement {
  if (override === "enabled") {
    return {
      enabled: projectEnabled,
      effectiveEnabled: true,
      enablementSource: "conversation-enabled",
    };
  }

  if (override === "disabled") {
    return {
      enabled: projectEnabled,
      effectiveEnabled: false,
      enablementSource: "conversation-disabled",
    };
  }

  if (projectEnabled) {
    return {
      enabled: true,
      effectiveEnabled: true,
      enablementSource: "project-enabled",
    };
  }

  return {
    enabled: false,
    effectiveEnabled: false,
    enablementSource: scoped ? "not-enabled" : "catalog-only",
  };
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  let body: z.infer<typeof statusRequestSchema>;

  try {
    body = statusRequestSchema.parse(await request.json());
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const localUser = await ensureLocalNetworkUser();
    let projectId = body.projectId ?? null;
    let chatId: string | undefined;

    if (body.chatId) {
      const chat = await getChatById({ id: body.chatId });
      if (!chat || chat.userId !== localUser.id) {
        throw new ChatbotError("not_found:chat");
      }
      chatId = chat.id;
      projectId = chat.projectId;
    } else if (projectId) {
      const project = await getProjectById({ id: projectId });
      if (!project || project.userId !== localUser.id) {
        throw new ChatbotError("not_found:chat");
      }
    }

    const [catalog, projectDefaults, chatOverrides] = await Promise.all([
      readUserMcpCatalog(localUser.id),
      projectId ? getProjectMcpServers({ projectId }) : [],
      chatId ? getChatMcpServerOverrides({ chatId }) : [],
    ]);
    const requestedServerIds =
      body.serverIds && body.serverIds.length > 0
        ? new Set(body.serverIds)
        : undefined;
    const projectDefaultByServerId = new Map(
      projectDefaults.map((server) => [server.serverId, server.enabled])
    );
    const overrideByServerId = new Map(
      chatOverrides.map((override) => [override.serverId, override.state])
    );
    const summaries = catalog.servers.filter(
      (server) => !requestedServerIds || requestedServerIds.has(server.id)
    );
    const probes = await mapWithConcurrency(summaries, 2, async (summary) => {
      const server = catalog.catalog.mcpServers[summary.id];
      if (!server) {
        return NOT_TESTED;
      }
      return probeMcpServer({ server });
    });

    return Response.json({
      servers: summaries.map((summary, index) => ({
        ...summary,
        ...resolveEnablement({
          override: overrideByServerId.get(summary.id),
          projectEnabled: projectDefaultByServerId.get(summary.id) ?? false,
          scoped: Boolean(projectId || chatId),
        }),
        ...probes[index],
      })),
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
