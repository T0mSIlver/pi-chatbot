import { readFile, stat } from "node:fs/promises";
import { ChatbotError } from "@/lib/errors";
import { APP_PREVIEW_CSP } from "@/lib/pi/app-preview";
import { getAuthorizedWorkspace } from "@/lib/pi/workspace-auth";
import {
  getWorkspaceContentType,
  resolveWorkspacePath,
} from "@/lib/pi/workspace-files";
import type { WorkspaceScope } from "@/lib/types";

function parseScope(value: string): WorkspaceScope {
  if (value !== "conversation" && value !== "shared") {
    throw new Error("Invalid workspace scope");
  }
  return value;
}

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      chatId: string;
      scope: string;
      path: string[];
    }>;
  }
) {
  try {
    const { chatId, scope, path: pathSegments } = await params;
    const parsedScope = parseScope(scope);
    const { roots } = await getAuthorizedWorkspace(chatId);
    const requestedPath = pathSegments.join("/");
    const resolved = await resolveWorkspacePath({
      roots,
      scope: parsedScope,
      path: requestedPath,
    });
    const stats = await stat(resolved.absolutePath);

    if (!stats.isFile()) {
      return new ChatbotError("bad_request:api").toResponse();
    }

    return new Response(await readFile(resolved.absolutePath), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": APP_PREVIEW_CSP,
        "Content-Type": getWorkspaceContentType(resolved.normalizedPath),
        "X-Content-Type-Options": "nosniff",
      },
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
