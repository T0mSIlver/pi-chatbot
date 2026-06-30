import { ChatbotError } from "@/lib/errors";
import { getAuthorizedWorkspace } from "@/lib/pi/workspace-auth";
import {
  getWorkspaceContentType,
  readWorkspaceFile,
} from "@/lib/pi/workspace-files";
import type { WorkspaceScope } from "@/lib/types";

function parseScope(value: string | null): WorkspaceScope {
  return value === "shared" ? "shared" : "conversation";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");
  const scope = parseScope(searchParams.get("scope"));
  const requestedPath = searchParams.get("path");

  if (!requestedPath) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { roots } = await getAuthorizedWorkspace(chatId);
    const file = await readWorkspaceFile({
      roots,
      scope,
      path: requestedPath,
    });
    const appUrl = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/workspace/app/${encodeURIComponent(chatId ?? "")}/${file.scope}/${file.path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;

    return Response.json({
      file: {
        ...file,
        contentType: getWorkspaceContentType(file.path),
        appUrl,
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
