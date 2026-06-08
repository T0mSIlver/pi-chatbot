import "server-only";

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { Chat } from "@/lib/db/schema";
import type {
  WorkspaceChange,
  WorkspaceDisplayIntent,
  WorkspaceFileKind,
  WorkspaceFileNode,
  WorkspaceScope,
} from "@/lib/types";
import { getProjectSharedWorkspacePath, rebaseWorkspacePath } from "./workspace";

const INTERNAL_METADATA_DIR = ".pi-chatbot";
const INTERNAL_FILE_NAMES = new Set([
  INTERNAL_METADATA_DIR,
  ".pi",
  "pi-session.jsonl",
]);
const CONVERSATION_INTERNAL_NAMES = new Set([
  ...INTERNAL_FILE_NAMES,
  "project-shared",
]);
const CHANGES_FILE_NAME = "changes.json";
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
const WORKSPACE_DISPLAY_MODES = new Set([
  "auto",
  "text",
  "code",
  "markdown",
  "image",
  "csv",
  "html_app",
]);

export type WorkspaceRoots = {
  conversationPath: string;
  sharedPath?: string;
};

type WorkspaceFileSnapshotEntry = {
  path: string;
  scope: WorkspaceScope;
  size: number;
  mtimeMs: number;
  mtime: string;
  hash: string;
  fileKind: WorkspaceFileKind;
};

export type WorkspaceSnapshot = Map<string, WorkspaceFileSnapshotEntry>;

export type WorkspaceFileRead = {
  path: string;
  scope: WorkspaceScope;
  name: string;
  fileKind: WorkspaceFileKind;
  size: number;
  mtime: string;
  content?: string;
  contentTruncated: boolean;
};

export function getWorkspaceRoots(chat: Chat): WorkspaceRoots {
  return {
    conversationPath: rebaseWorkspacePath(chat.workspacePath),
    sharedPath: chat.projectId
      ? getProjectSharedWorkspacePath(chat.userId, chat.projectId)
      : undefined,
  };
}

function toPosixPath(parts: string[]) {
  return parts.filter(Boolean).join("/");
}

export function normalizeWorkspacePath(value: string) {
  let candidate = value.trim().replace(/^@+/, "").replaceAll("\\", "/");

  if (!candidate || candidate === ".") {
    return "";
  }

  while (candidate.startsWith("./")) {
    candidate = candidate.slice(2);
  }

  if (
    candidate.includes("\0") ||
    path.posix.isAbsolute(candidate) ||
    path.win32.isAbsolute(candidate) ||
    /^[a-zA-Z]:/.test(candidate)
  ) {
    throw new Error("Invalid workspace path");
  }

  const normalized = path.posix.normalize(candidate);
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error("Invalid workspace path");
  }

  return normalized === "." ? "" : normalized;
}

export function normalizeShowcasePath({
  path: inputPath,
  scope,
}: {
  path: string;
  scope?: WorkspaceScope;
}) {
  const normalized = normalizeWorkspacePath(inputPath);
  const [first, ...rest] = normalized.split("/");

  if (first === "project-shared") {
    return {
      scope: "shared" as const,
      path: toPosixPath(rest),
    };
  }

  return {
    scope: scope ?? ("conversation" as const),
    path: normalized,
  };
}

function hasInternalPathSegment(normalizedPath: string) {
  return normalizedPath
    .split("/")
    .some((segment) => INTERNAL_FILE_NAMES.has(segment));
}

function shouldExcludeFromTree(scope: WorkspaceScope, name: string) {
  return scope === "conversation"
    ? CONVERSATION_INTERNAL_NAMES.has(name)
    : INTERNAL_FILE_NAMES.has(name);
}

function assertUnderBase(resolvedPath: string, basePath: string) {
  const base = path.resolve(basePath);
  const target = path.resolve(resolvedPath);

  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new Error("Path is outside workspace");
  }
}

async function assertNoSymlinkSegments(
  basePath: string,
  normalizedPath: string
) {
  if (!normalizedPath) {
    return;
  }

  let current = basePath;
  for (const segment of normalizedPath.split("/")) {
    current = path.join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error("Symlink traversal is not allowed");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

export async function resolveWorkspacePath({
  roots,
  scope,
  path: inputPath,
}: {
  roots: WorkspaceRoots;
  scope: WorkspaceScope;
  path: string;
}) {
  const normalized = normalizeWorkspacePath(inputPath);

  if (!normalized) {
    throw new Error("Path is required");
  }

  if (hasInternalPathSegment(normalized)) {
    throw new Error("Internal workspace files are not accessible");
  }

  if (
    scope === "conversation" &&
    normalized.split("/")[0] === "project-shared"
  ) {
    throw new Error("Use shared scope for project-shared files");
  }

  const basePath =
    scope === "shared" ? roots.sharedPath : roots.conversationPath;

  if (!basePath) {
    throw new Error("Shared workspace is not available for this chat");
  }

  const resolvedPath = path.resolve(basePath, normalized);
  assertUnderBase(resolvedPath, basePath);

  await assertNoSymlinkSegments(basePath, normalized);

  const realBase = await realpath(basePath).catch(() => path.resolve(basePath));
  const realTarget = await realpath(resolvedPath).catch(() => resolvedPath);
  assertUnderBase(realTarget, realBase);

  return {
    absolutePath: resolvedPath,
    normalizedPath: normalized,
    basePath,
    scope,
  };
}

export function classifyWorkspaceFile(filePath: string): WorkspaceFileKind {
  const extension = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(extension)) {
    return "image";
  }
  if ([".html", ".htm"].includes(extension)) {
    return "html_app";
  }
  if ([".md", ".mdx"].includes(extension)) {
    return "markdown";
  }
  if ([".csv", ".tsv"].includes(extension)) {
    return "csv";
  }
  if (
    [
      ".c",
      ".cc",
      ".cpp",
      ".cs",
      ".css",
      ".go",
      ".java",
      ".js",
      ".jsx",
      ".json",
      ".mjs",
      ".py",
      ".rs",
      ".sh",
      ".sql",
      ".ts",
      ".tsx",
      ".xml",
      ".yaml",
      ".yml",
    ].includes(extension) ||
    ["dockerfile", "makefile"].includes(basename)
  ) {
    return "code";
  }
  if (
    [".env", ".ini", ".log", ".toml", ".txt", ".conf", ".config"].includes(
      extension
    )
  ) {
    return "text";
  }

  return "binary";
}

export function getWorkspaceContentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const contentTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".tsv": "text/tab-separated-values; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".webp": "image/webp",
  };

  return contentTypes[extension] ?? "application/octet-stream";
}

function canReadTextContent(fileKind: WorkspaceFileKind) {
  return ["code", "csv", "html_app", "markdown", "text"].includes(fileKind);
}

export async function readWorkspaceFile({
  roots,
  scope,
  path: inputPath,
}: {
  roots: WorkspaceRoots;
  scope: WorkspaceScope;
  path: string;
}): Promise<WorkspaceFileRead> {
  const resolved = await resolveWorkspacePath({
    roots,
    scope,
    path: inputPath,
  });
  const stats = await stat(resolved.absolutePath);

  if (!stats.isFile()) {
    throw new Error("Path is not a file");
  }

  const fileKind = classifyWorkspaceFile(resolved.normalizedPath);
  const shouldReadContent =
    canReadTextContent(fileKind) && stats.size <= MAX_TEXT_PREVIEW_BYTES;

  return {
    path: resolved.normalizedPath,
    scope,
    name: path.basename(resolved.normalizedPath),
    fileKind,
    size: stats.size,
    mtime: stats.mtime.toISOString(),
    content: shouldReadContent
      ? await readFile(resolved.absolutePath, "utf8")
      : undefined,
    contentTruncated: canReadTextContent(fileKind) && !shouldReadContent,
  };
}

async function buildTreeChildren({
  basePath,
  relativePath,
  scope,
}: {
  basePath: string;
  relativePath: string;
  scope: WorkspaceScope;
}): Promise<WorkspaceFileNode[]> {
  let entries: Awaited<ReturnType<typeof readdir>>;

  try {
    entries = await readdir(path.join(basePath, relativePath), {
      withFileTypes: true,
    });
  } catch {
    return [];
  }

  const nodes: Array<WorkspaceFileNode | null> = await Promise.all(
    entries
      .filter((entry) => !shouldExcludeFromTree(scope, entry.name))
      .map(async (entry) => {
        const entryRelativePath = toPosixPath([relativePath, entry.name]);
        const absolutePath = path.join(basePath, entryRelativePath);
        const stats = await lstat(absolutePath).catch(() => null);

        if (!stats || stats.isSymbolicLink()) {
          return null;
        }

        if (stats.isDirectory()) {
          return {
            name: entry.name,
            path: entryRelativePath,
            scope,
            kind: "directory" as const,
            mtime: stats.mtime.toISOString(),
            children: await buildTreeChildren({
              basePath,
              relativePath: entryRelativePath,
              scope,
            }),
          };
        }

        if (!stats.isFile()) {
          return null;
        }

        return {
          name: entry.name,
          path: entryRelativePath,
          scope,
          kind: "file" as const,
          fileKind: classifyWorkspaceFile(entryRelativePath),
          size: stats.size,
          mtime: stats.mtime.toISOString(),
        };
      })
  );

  return nodes
    .filter((node): node is WorkspaceFileNode => node !== null)
    .sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
}

export async function buildWorkspaceTree(roots: WorkspaceRoots) {
  const [conversationChildren, sharedChildren] = await Promise.all([
    buildTreeChildren({
      basePath: roots.conversationPath,
      relativePath: "",
      scope: "conversation",
    }),
    roots.sharedPath
      ? buildTreeChildren({
          basePath: roots.sharedPath,
          relativePath: "",
          scope: "shared",
        })
      : Promise.resolve([]),
  ]);

  const tree: WorkspaceFileNode[] = [
    {
      name: "Conversation",
      path: "",
      scope: "conversation" as const,
      kind: "directory" as const,
      children: conversationChildren,
    },
  ];

  if (roots.sharedPath) {
    tree.push({
      name: "Project shared",
      path: "",
      scope: "shared" as const,
      kind: "directory" as const,
      children: sharedChildren,
    });
  }

  return tree;
}

async function hashFile(filePath: string) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

async function snapshotRoot({
  basePath,
  relativePath,
  scope,
  snapshot,
}: {
  basePath: string;
  relativePath: string;
  scope: WorkspaceScope;
  snapshot: WorkspaceSnapshot;
}) {
  let entries: Awaited<ReturnType<typeof readdir>>;

  try {
    entries = await readdir(path.join(basePath, relativePath), {
      withFileTypes: true,
    });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (shouldExcludeFromTree(scope, entry.name)) {
      continue;
    }

    const entryRelativePath = toPosixPath([relativePath, entry.name]);
    const absolutePath = path.join(basePath, entryRelativePath);
    const stats = await lstat(absolutePath).catch(() => null);

    if (!stats || stats.isSymbolicLink()) {
      continue;
    }

    if (stats.isDirectory()) {
      await snapshotRoot({
        basePath,
        relativePath: entryRelativePath,
        scope,
        snapshot,
      });
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }

    const fileKind = classifyWorkspaceFile(entryRelativePath);
    snapshot.set(`${scope}:${entryRelativePath}`, {
      path: entryRelativePath,
      scope,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      mtime: stats.mtime.toISOString(),
      hash: await hashFile(absolutePath),
      fileKind,
    });
  }
}

export async function snapshotWorkspaceFiles(
  roots: WorkspaceRoots
): Promise<WorkspaceSnapshot> {
  const snapshot: WorkspaceSnapshot = new Map();

  const tasks = [
    snapshotRoot({
      basePath: roots.conversationPath,
      relativePath: "",
      scope: "conversation",
      snapshot,
    }),
  ];

  if (roots.sharedPath) {
    tasks.push(
      snapshotRoot({
        basePath: roots.sharedPath,
        relativePath: "",
        scope: "shared",
        snapshot,
      })
    );
  }

  await Promise.all(tasks);

  return snapshot;
}

export function diffWorkspaceSnapshots(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot
): WorkspaceChange[] {
  const changes: WorkspaceChange[] = [];

  for (const [key, afterEntry] of after) {
    const beforeEntry = before.get(key);
    if (!beforeEntry) {
      changes.push({
        path: afterEntry.path,
        scope: afterEntry.scope,
        change: "created",
        fileKind: afterEntry.fileKind,
        size: afterEntry.size,
        mtime: afterEntry.mtime,
      });
      continue;
    }

    if (
      beforeEntry.size !== afterEntry.size ||
      beforeEntry.mtimeMs !== afterEntry.mtimeMs ||
      beforeEntry.hash !== afterEntry.hash
    ) {
      changes.push({
        path: afterEntry.path,
        scope: afterEntry.scope,
        change: "modified",
        fileKind: afterEntry.fileKind,
        size: afterEntry.size,
        mtime: afterEntry.mtime,
      });
    }
  }

  for (const [key, beforeEntry] of before) {
    if (!after.has(key)) {
      changes.push({
        path: beforeEntry.path,
        scope: beforeEntry.scope,
        change: "deleted",
        fileKind: beforeEntry.fileKind,
      });
    }
  }

  return changes.sort((a, b) => {
    if (a.scope !== b.scope) {
      return a.scope.localeCompare(b.scope);
    }
    return a.path.localeCompare(b.path);
  });
}

function getChangesFilePath(conversationPath: string) {
  return path.join(conversationPath, INTERNAL_METADATA_DIR, CHANGES_FILE_NAME);
}

export async function writeWorkspaceChanges({
  conversationPath,
  changes,
}: {
  conversationPath: string;
  changes: WorkspaceChange[];
}) {
  const metadataPath = path.join(conversationPath, INTERNAL_METADATA_DIR);
  await mkdir(metadataPath, { recursive: true });
  await writeFile(
    getChangesFilePath(conversationPath),
    `${JSON.stringify({ updatedAt: new Date().toISOString(), changes }, null, 2)}\n`
  );
}

export async function readWorkspaceChanges(conversationPath: string) {
  try {
    const parsed = JSON.parse(
      await readFile(getChangesFilePath(conversationPath), "utf8")
    ) as { updatedAt?: string; changes?: WorkspaceChange[] };

    return {
      updatedAt: parsed.updatedAt ?? null,
      changes: Array.isArray(parsed.changes) ? parsed.changes : [],
    };
  } catch {
    return { updatedAt: null, changes: [] };
  }
}

function isWorkspaceDisplayMode(
  value: unknown
): value is NonNullable<WorkspaceDisplayIntent["mode"]> {
  return typeof value === "string" && WORKSPACE_DISPLAY_MODES.has(value);
}

function normalizeWorkspaceDisplayIntent(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { type?: unknown }).type !== "workspace-file" ||
    typeof (value as { chatId?: unknown }).chatId !== "string" ||
    typeof (value as { path?: unknown }).path !== "string" ||
    !["conversation", "shared"].includes(
      String((value as { scope?: unknown }).scope)
    )
  ) {
    return null;
  }

  const intent = value as WorkspaceDisplayIntent;
  return {
    type: "workspace-file" as const,
    chatId: intent.chatId,
    scope: intent.scope,
    path: intent.path,
    title:
      typeof intent.title === "string" && intent.title.trim()
        ? intent.title
        : undefined,
    mode: isWorkspaceDisplayMode(intent.mode) ? intent.mode : undefined,
    line:
      typeof intent.line === "number" && Number.isFinite(intent.line)
        ? Math.max(1, Math.floor(intent.line))
        : undefined,
  } satisfies WorkspaceDisplayIntent;
}

export function displayIntentFromToolResult(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const intent =
    "displayIntent" in value
      ? (value as { displayIntent?: unknown }).displayIntent
      : value;

  return normalizeWorkspaceDisplayIntent(intent);
}

export function displayIntentFromShowcaseToolInput({
  value,
  chatId,
}: {
  value: unknown;
  chatId?: string | null;
}) {
  if (!chatId || typeof value !== "object" || value === null) {
    return null;
  }

  const input = value as {
    path?: unknown;
    scope?: unknown;
    mode?: unknown;
    title?: unknown;
    line?: unknown;
  };

  if (typeof input.path !== "string") {
    return null;
  }

  const explicitScope =
    input.scope === "conversation" || input.scope === "shared"
      ? input.scope
      : undefined;

  try {
    const normalized = normalizeShowcasePath({
      path: input.path,
      scope: explicitScope,
    });

    if (!normalized.path) {
      return null;
    }

    return {
      type: "workspace-file" as const,
      chatId,
      scope: normalized.scope,
      path: normalized.path,
      title:
        typeof input.title === "string" && input.title.trim()
          ? input.title
          : undefined,
      mode: isWorkspaceDisplayMode(input.mode) ? input.mode : undefined,
      line:
        typeof input.line === "number" && Number.isFinite(input.line)
          ? Math.max(1, Math.floor(input.line))
          : undefined,
    } satisfies WorkspaceDisplayIntent;
  } catch {
    return null;
  }
}
