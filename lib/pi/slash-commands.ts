import "server-only";

import {
  DefaultResourceLoader,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { isTestEnvironment } from "@/lib/constants";
import { ensureLocalNetworkUser, getChatById } from "@/lib/db/queries";
import {
  getBundledExtensionPaths,
  getBundledSkillPaths,
  withMcpAdapterEnvironment,
} from "./session";
import { getConversationWorkspacePath, rebaseWorkspacePath } from "./workspace";

export type PiSlashCommandSource = "builtin" | "extension" | "prompt" | "skill";

export type PiSlashCommand = {
  name: string;
  description?: string;
  source: PiSlashCommandSource;
  argumentHint?: string;
};

/**
 * Builtin pi commands surfaced in the web app. pi's full builtin list
 * (BUILTIN_SLASH_COMMANDS) is not exported from the package entrypoint and is
 * dominated by terminal-only actions (hotkeys, quit, settings, ...), so the
 * agent-relevant ones are wired explicitly here and handled in the chat route.
 */
const WEB_BUILTIN_COMMANDS: PiSlashCommand[] = [
  {
    name: "compact",
    description: "Compact the conversation context",
    source: "builtin",
    argumentHint: "[instructions]",
  },
];

/**
 * Parse "/name args" input. Returns null for anything that is not a slash
 * token followed by horizontal whitespace on the first line — notably
 * absolute paths ("/home/x/file") and multi-line prose whose first line is a
 * lone slash token ("/done\nnotes") flow to the model as plain text. Unknown
 * command names are fine: pi's prompt() forwards them to the model verbatim.
 */
export function parseSlashCommandInput(text: string) {
  const match = text.trim().match(/^\/([\w:.-]+)(?:[ \t]+([\s\S]+))?$/);
  if (!match) {
    return null;
  }
  return { name: match[1], args: match[2]?.trim() ?? "" };
}

async function resolveCommandWorkspace(chatId: string) {
  const chat = await getChatById({ id: chatId });
  if (chat) {
    return {
      cacheKey: chatId,
      workspacePath: rebaseWorkspacePath(chat.workspacePath),
    };
  }

  // Chat not created yet (no message sent): only global + bundled resources
  // exist, so share one stable probe workspace (and cache entry) instead of
  // creating a throwaway directory tree per prospective chat id.
  const localUser = await ensureLocalNetworkUser();
  return {
    cacheKey: "__global__",
    workspacePath: getConversationWorkspacePath({
      userId: localUser.id,
      projectId: null,
      conversationId: "__commands-probe__",
    }),
  };
}

async function computePiSlashCommands(
  workspacePath: string
): Promise<PiSlashCommand[]> {
  const agentDir = getAgentDir();

  const resourceLoader = await withMcpAdapterEnvironment(
    workspacePath,
    async () => {
      const loader = new DefaultResourceLoader({
        cwd: workspacePath,
        agentDir,
        additionalExtensionPaths: getBundledExtensionPaths(),
        additionalSkillPaths: getBundledSkillPaths(),
      });
      await loader.reload();
      return loader;
    }
  );

  const commands: PiSlashCommand[] = [...WEB_BUILTIN_COMMANDS];

  for (const extension of resourceLoader.getExtensions().extensions) {
    for (const command of extension.commands.values()) {
      commands.push({
        name: command.name,
        description: command.description,
        source: "extension",
      });
    }
  }

  for (const template of resourceLoader.getPrompts().prompts) {
    commands.push({
      name: template.name,
      description: template.description,
      source: "prompt",
      argumentHint: template.argumentHint,
    });
  }

  for (const skill of resourceLoader.getSkills().skills) {
    commands.push({
      name: `skill:${skill.name}`,
      description: skill.description,
      source: "skill",
    });
  }

  const seen = new Set<string>();
  return commands.filter((command) => {
    if (seen.has(command.name)) {
      return false;
    }
    seen.add(command.name);
    return true;
  });
}

const CACHE_TTL_MS = 30_000;
const commandCache = new Map<
  string,
  { expiresAt: number; value: Promise<PiSlashCommand[]> }
>();

/**
 * List the pi slash commands available in a chat's session: extension
 * commands, prompt templates, skills, plus the curated builtins above. Loads
 * resources the same way createPiSdkSession does but without creating an
 * agent session (extension factories run and register commands at load time;
 * MCP servers only connect on session_start, which never fires here).
 */
export async function listPiSlashCommands(chatId: string) {
  if (isTestEnvironment) {
    return WEB_BUILTIN_COMMANDS;
  }

  const { cacheKey, workspacePath } = await resolveCommandWorkspace(chatId);

  const now = Date.now();
  const cached = commandCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = computePiSlashCommands(workspacePath);
  commandCache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, value });
  value.catch(() => {
    // Only evict our own entry — a post-TTL recompute may have replaced it
    // with a healthy one by the time this rejection lands.
    if (commandCache.get(cacheKey)?.value === value) {
      commandCache.delete(cacheKey);
    }
  });
  return value;
}
