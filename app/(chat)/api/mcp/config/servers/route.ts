import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  ensureLocalNetworkUser,
  upsertMcpConfigByUserId,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import {
  addMcpServerToCatalog,
  buildMcpServerEntry,
  normalizeMcpServerId,
} from "@/lib/pi/mcp-catalog";
import {
  formatMcpCatalog,
  parseMcpCatalogText,
  readUserMcpCatalog,
} from "@/lib/pi/mcp-config";

const lifecycleSchema = z.enum(["lazy", "eager", "keep-alive"]);

const addMcpServerSchema = z.discriminatedUnion("mode", [
  z.object({
    command: z.string().min(1),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    id: z.string().min(1),
    lifecycle: lifecycleSchema.optional(),
    mode: z.literal("command"),
  }),
  z.object({
    auth: z.enum(["none", "bearer", "oauth"]).optional(),
    bearerTokenEnv: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    id: z.string().min(1),
    lifecycle: lifecycleSchema.optional(),
    mode: z.literal("url"),
    url: z.string().min(1),
  }),
]);

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  let body: z.infer<typeof addMcpServerSchema>;

  try {
    body = addMcpServerSchema.parse(await request.json());
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const localUser = await ensureLocalNetworkUser();
    const current = await readUserMcpCatalog(localUser.id);
    const id = normalizeMcpServerId(body.id);
    const entry = buildMcpServerEntry({ ...body, id });
    const catalog = addMcpServerToCatalog({
      catalog: current.catalog,
      entry,
      id,
    });
    const formattedJson = formatMcpCatalog(parseMcpCatalogText(formatMcpCatalog(catalog)));

    await upsertMcpConfigByUserId({
      json: formattedJson,
      userId: localUser.id,
    });

    const config = await readUserMcpCatalog(localUser.id);

    return Response.json(
      {
        json: config.json,
        servers: config.servers,
      },
      { status: 201 }
    );
  } catch (error) {
    return new ChatbotError(
      "bad_request:api",
      error instanceof Error ? error.message : undefined
    ).toResponse();
  }
}
