import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  ensureLocalNetworkUser,
  upsertMcpConfigByUserId,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import {
  formatMcpCatalog,
  parseMcpCatalogText,
  readUserMcpCatalog,
} from "@/lib/pi/mcp-config";

const updateMcpConfigSchema = z.object({
  json: z.string().min(1),
});

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const localUser = await ensureLocalNetworkUser();
  const config = await readUserMcpCatalog(localUser.id);

  return Response.json({
    json: config.json,
    servers: config.servers,
  });
}

export async function PATCH(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  let json: string;

  try {
    json = updateMcpConfigSchema.parse(await request.json()).json;
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  let formattedJson: string;

  try {
    formattedJson = formatMcpCatalog(parseMcpCatalogText(json));
  } catch (error) {
    return new ChatbotError(
      "bad_request:api",
      error instanceof Error ? error.message : undefined
    ).toResponse();
  }

  const localUser = await ensureLocalNetworkUser();
  await upsertMcpConfigByUserId({
    userId: localUser.id,
    json: formattedJson,
  });

  const config = await readUserMcpCatalog(localUser.id);

  return Response.json({
    json: config.json,
    servers: config.servers,
  });
}
