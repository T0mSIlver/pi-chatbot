import "server-only";

import { stat } from "node:fs/promises";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { WorkspaceDisplayIntent, WorkspaceScope } from "@/lib/types";
import {
  classifyWorkspaceFile,
  normalizeShowcasePath,
  resolveWorkspacePath,
} from "./workspace-files";

const workspaceScopeSchema = Type.Union([
  Type.Literal("conversation"),
  Type.Literal("shared"),
]);

const displayModeSchema = Type.Union([
  Type.Literal("auto"),
  Type.Literal("text"),
  Type.Literal("code"),
  Type.Literal("markdown"),
  Type.Literal("image"),
  Type.Literal("csv"),
  Type.Literal("html_app"),
]);

export function createShowcaseFileTool({
  chatId,
  conversationPath,
  sharedPath,
}: {
  chatId: string;
  conversationPath: string;
  sharedPath?: string;
}): ToolDefinition {
  return defineTool({
    name: "showcase_file",
    label: "showcase file",
    description:
      "Open a workspace file in the app preview pane without printing the full file contents in chat.",
    promptSnippet:
      "Open a generated or edited workspace file in the preview pane",
    promptGuidelines: [
      "Use showcase_file after creating or updating a file the user should inspect visually.",
      "Use showcase_file for generated HTML apps, markdown documents, images, CSV files, or code files that are better viewed in the side pane.",
      "Do not paste file contents into chat after using showcase_file.",
    ],
    parameters: Type.Object({
      path: Type.String({
        description:
          "Path to the workspace file. Use project-shared/... or scope=shared for project-shared files.",
      }),
      scope: Type.Optional(workspaceScopeSchema),
      mode: Type.Optional(displayModeSchema),
      title: Type.Optional(Type.String({ description: "Preview title" })),
      line: Type.Optional(
        Type.Integer({
          description: "Optional 1-indexed line to focus in the preview",
          minimum: 1,
        })
      ),
    }),
    async execute(_toolCallId, params) {
      const normalized = normalizeShowcasePath({
        path: params.path,
        scope: params.scope as WorkspaceScope | undefined,
      });
      const resolved = await resolveWorkspacePath({
        roots: { conversationPath, sharedPath },
        scope: normalized.scope,
        path: normalized.path,
      });
      const stats = await stat(resolved.absolutePath);

      if (!stats.isFile()) {
        throw new Error(`showcase_file expected a file: ${normalized.path}`);
      }

      const fileKind = classifyWorkspaceFile(normalized.path);
      const detectedMode =
        params.mode && params.mode !== "auto"
          ? params.mode
          : fileKind === "binary"
            ? undefined
            : fileKind;
      const intent: WorkspaceDisplayIntent = {
        type: "workspace-file",
        chatId,
        scope: normalized.scope,
        path: normalized.path,
        mode: detectedMode,
        title: params.title,
        line: params.line,
      };

      return {
        content: [
          {
            type: "text",
            text: `Opened ${normalized.scope}:${normalized.path} in the preview pane.`,
          },
        ],
        details: {
          displayIntent: intent,
        },
      };
    },
  });
}
