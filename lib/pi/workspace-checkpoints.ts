import "server-only";

import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  WorkspaceChange,
  WorkspaceFileKind,
  WorkspaceScope,
} from "@/lib/types";
import {
  classifyWorkspaceFile,
  diffWorkspaceSnapshots,
  snapshotWorkspaceFiles,
  type WorkspaceRoots,
  type WorkspaceSnapshot,
} from "./workspace-files";

export const ROOT_WORKSPACE_CHECKPOINT_ID = "root";

const CHECKPOINTS_DIR = "checkpoints";
const BLOBS_DIR = "blobs";
const MANIFEST_FILE = "manifest.json";
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
const WORKSPACE_FILE_KINDS = new Set<WorkspaceFileKind>([
  "binary",
  "code",
  "csv",
  "html_app",
  "image",
  "markdown",
  "text",
]);

type WorkspaceCheckpointFile = {
  path: string;
  scope: WorkspaceScope;
  size: number;
  hash: string;
  fileKind: WorkspaceFileKind;
};

type WorkspaceCheckpointManifest = {
  version: 1;
  checkpointId: string;
  createdAt: string;
  files: WorkspaceCheckpointFile[];
};

type CapturedWorkspaceFile = WorkspaceCheckpointFile & {
  absolutePath: string;
  content: Buffer;
};

type PlanWorkspaceRestoreArgs = {
  sourceConversationPath: string;
  targetRoots: WorkspaceRoots;
  checkpointId: string;
  emptyConversation?: boolean;
};

type RestoreWorkspaceCheckpointArgs = PlanWorkspaceRestoreArgs;

function safeCheckpointId(checkpointId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(checkpointId)) {
    throw new Error("Invalid checkpoint id");
  }

  return checkpointId;
}

function checkpointRoot(conversationPath: string) {
  return path.join(conversationPath, INTERNAL_METADATA_DIR, CHECKPOINTS_DIR);
}

function checkpointDir(conversationPath: string, checkpointId: string) {
  return path.join(
    checkpointRoot(conversationPath),
    safeCheckpointId(checkpointId)
  );
}

function manifestPath(conversationPath: string, checkpointId: string) {
  return path.join(
    checkpointDir(conversationPath, checkpointId),
    MANIFEST_FILE
  );
}

function blobPath(
  conversationPath: string,
  checkpointId: string,
  hash: string
) {
  return path.join(
    checkpointDir(conversationPath, checkpointId),
    BLOBS_DIR,
    hash
  );
}

function workspaceKey(scope: WorkspaceScope, filePath: string) {
  return `${scope}:${filePath}`;
}

function shouldExclude(scope: WorkspaceScope, name: string) {
  return scope === "conversation"
    ? CONVERSATION_INTERNAL_NAMES.has(name)
    : INTERNAL_FILE_NAMES.has(name);
}

function isWorkspaceScope(value: unknown): value is WorkspaceScope {
  return value === "conversation" || value === "shared";
}

function isWorkspaceFileKind(value: unknown): value is WorkspaceFileKind {
  return (
    typeof value === "string" &&
    WORKSPACE_FILE_KINDS.has(value as WorkspaceFileKind)
  );
}

function isSafeManifestPath(scope: WorkspaceScope, filePath: string) {
  if (
    !filePath ||
    filePath.includes("\0") ||
    path.posix.isAbsolute(filePath) ||
    path.win32.isAbsolute(filePath) ||
    /^[a-zA-Z]:/.test(filePath)
  ) {
    return false;
  }

  const normalized = path.posix.normalize(filePath);
  if (
    normalized !== filePath ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    return false;
  }

  return !normalized
    .split("/")
    .some((segment) => shouldExclude(scope, segment));
}

function isCheckpointFile(value: unknown): value is WorkspaceCheckpointFile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const file = value as Partial<WorkspaceCheckpointFile>;
  return (
    isWorkspaceScope(file.scope) &&
    typeof file.path === "string" &&
    isSafeManifestPath(file.scope, file.path) &&
    typeof file.size === "number" &&
    Number.isFinite(file.size) &&
    file.size >= 0 &&
    typeof file.hash === "string" &&
    /^[a-f0-9]{64}$/.test(file.hash) &&
    isWorkspaceFileKind(file.fileKind)
  );
}

function assertUnderBase(resolvedPath: string, basePath: string) {
  const base = path.resolve(basePath);
  const target = path.resolve(resolvedPath);

  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new Error("Path is outside workspace");
  }
}

function targetPath({
  roots,
  scope,
  filePath,
}: {
  roots: WorkspaceRoots;
  scope: WorkspaceScope;
  filePath: string;
}) {
  const basePath =
    scope === "shared" ? roots.sharedPath : roots.conversationPath;

  if (!basePath) {
    throw new Error("Shared workspace is not available for this chat");
  }

  const resolvedPath = path.resolve(basePath, filePath);
  assertUnderBase(resolvedPath, basePath);
  return resolvedPath;
}

function hashBuffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function checkpointExists(
  conversationPath: string,
  checkpointId: string
) {
  try {
    await lstat(manifestPath(conversationPath, checkpointId));
    return true;
  } catch {
    return false;
  }
}

async function captureRoot({
  basePath,
  relativePath,
  scope,
  files,
}: {
  basePath: string;
  relativePath: string;
  scope: WorkspaceScope;
  files: CapturedWorkspaceFile[];
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
    if (shouldExclude(scope, entry.name)) {
      continue;
    }

    const entryRelativePath = [relativePath, entry.name]
      .filter(Boolean)
      .join("/");
    const absolutePath = path.join(basePath, entryRelativePath);
    const stats = await lstat(absolutePath).catch(() => null);

    if (!stats || stats.isSymbolicLink()) {
      continue;
    }

    if (stats.isDirectory()) {
      await captureRoot({
        basePath,
        relativePath: entryRelativePath,
        scope,
        files,
      });
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }

    const content = await readFile(absolutePath);
    files.push({
      absolutePath,
      content,
      fileKind: classifyWorkspaceFile(entryRelativePath),
      hash: hashBuffer(content),
      path: entryRelativePath,
      scope,
      size: stats.size,
    });
  }
}

async function captureWorkspaceFiles(roots: WorkspaceRoots) {
  const files: CapturedWorkspaceFile[] = [];

  const tasks = [
    captureRoot({
      basePath: roots.conversationPath,
      relativePath: "",
      scope: "conversation",
      files,
    }),
  ];

  if (roots.sharedPath) {
    tasks.push(
      captureRoot({
        basePath: roots.sharedPath,
        relativePath: "",
        scope: "shared",
        files,
      })
    );
  }

  await Promise.all(tasks);

  return files;
}

async function readManifest(
  conversationPath: string,
  checkpointId: string
): Promise<WorkspaceCheckpointManifest | null> {
  try {
    const parsed = JSON.parse(
      await readFile(manifestPath(conversationPath, checkpointId), "utf8")
    ) as WorkspaceCheckpointManifest;

    if (
      parsed.version !== 1 ||
      parsed.checkpointId !== checkpointId ||
      !Array.isArray(parsed.files) ||
      !parsed.files.every(isCheckpointFile)
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function manifestToSnapshot(manifest: WorkspaceCheckpointManifest) {
  const snapshot: WorkspaceSnapshot = new Map();
  const mtime = manifest.createdAt;
  const mtimeMs = new Date(manifest.createdAt).getTime();

  for (const file of manifest.files) {
    snapshot.set(workspaceKey(file.scope, file.path), {
      fileKind: file.fileKind,
      hash: file.hash,
      mtime,
      mtimeMs: Number.isNaN(mtimeMs) ? 0 : mtimeMs,
      path: file.path,
      scope: file.scope,
      size: file.size,
    });
  }

  return snapshot;
}

async function currentSnapshotForRestore({
  targetRoots,
  emptyConversation,
}: {
  targetRoots: WorkspaceRoots;
  emptyConversation?: boolean;
}) {
  const snapshot = await snapshotWorkspaceFiles(targetRoots);

  if (!emptyConversation) {
    return snapshot;
  }

  for (const key of [...snapshot.keys()]) {
    if (key.startsWith("conversation:")) {
      snapshot.delete(key);
    }
  }

  return snapshot;
}

async function removeEmptyDirectories({
  basePath,
  scope,
  relativePath = "",
}: {
  basePath: string;
  scope: WorkspaceScope;
  relativePath?: string;
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
    if (shouldExclude(scope, entry.name)) {
      continue;
    }

    const childRelativePath = [relativePath, entry.name]
      .filter(Boolean)
      .join("/");
    const absolutePath = path.join(basePath, childRelativePath);
    const stats = await lstat(absolutePath).catch(() => null);

    if (!stats?.isDirectory() || stats.isSymbolicLink()) {
      continue;
    }

    await removeEmptyDirectories({
      basePath,
      scope,
      relativePath: childRelativePath,
    });
    await rm(absolutePath, { recursive: false }).catch(() => undefined);
  }
}

export async function createWorkspaceCheckpoint({
  roots,
  conversationPath,
  checkpointId,
}: {
  roots: WorkspaceRoots;
  conversationPath: string;
  checkpointId: string;
}) {
  const safeId = safeCheckpointId(checkpointId);

  if (await checkpointExists(conversationPath, safeId)) {
    return { checkpointId: safeId, created: false };
  }

  const files = await captureWorkspaceFiles(roots);
  const createdAt = new Date().toISOString();
  const dir = checkpointDir(conversationPath, safeId);

  await mkdir(path.join(dir, BLOBS_DIR), { recursive: true });

  for (const file of files) {
    await writeFile(
      blobPath(conversationPath, safeId, file.hash),
      file.content
    );
  }

  const manifest: WorkspaceCheckpointManifest = {
    version: 1,
    checkpointId: safeId,
    createdAt,
    files: files.map(
      ({ content: _content, absolutePath: _absolutePath, ...file }) => file
    ),
  };

  await writeFile(
    manifestPath(conversationPath, safeId),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  return { checkpointId: safeId, created: true };
}

export async function planWorkspaceRestore({
  sourceConversationPath,
  targetRoots,
  checkpointId,
  emptyConversation,
}: PlanWorkspaceRestoreArgs) {
  const safeId = safeCheckpointId(checkpointId);
  const manifest = await readManifest(sourceConversationPath, safeId);

  if (!manifest) {
    return {
      checkpointId: safeId,
      changes: [] as WorkspaceChange[],
      missingCheckpoint: true,
    };
  }

  const before = await currentSnapshotForRestore({
    targetRoots,
    emptyConversation,
  });
  const after = manifestToSnapshot(manifest);

  return {
    checkpointId: safeId,
    changes: diffWorkspaceSnapshots(before, after),
    missingCheckpoint: false,
  };
}

export async function restoreWorkspaceCheckpoint({
  sourceConversationPath,
  targetRoots,
  checkpointId,
}: RestoreWorkspaceCheckpointArgs) {
  const safeId = safeCheckpointId(checkpointId);
  const manifest = await readManifest(sourceConversationPath, safeId);

  if (!manifest) {
    return {
      checkpointId: safeId,
      changes: [] as WorkspaceChange[],
      missingCheckpoint: true,
    };
  }

  const plan = await planWorkspaceRestore({
    sourceConversationPath,
    targetRoots,
    checkpointId: safeId,
  });
  const checkpointFiles = new Map(
    manifest.files.map((file) => [workspaceKey(file.scope, file.path), file])
  );
  const current = await snapshotWorkspaceFiles(targetRoots);

  for (const [key, file] of current) {
    if (!checkpointFiles.has(key)) {
      await rm(
        targetPath({
          roots: targetRoots,
          scope: file.scope,
          filePath: file.path,
        }),
        { force: true }
      );
    }
  }

  for (const file of manifest.files) {
    const currentFile = current.get(workspaceKey(file.scope, file.path));
    if (currentFile?.hash === file.hash && currentFile.size === file.size) {
      continue;
    }

    const destinationPath = targetPath({
      roots: targetRoots,
      scope: file.scope,
      filePath: file.path,
    });
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(
      blobPath(sourceConversationPath, safeId, file.hash),
      destinationPath
    );
  }

  const cleanupTasks = [
    removeEmptyDirectories({
      basePath: targetRoots.conversationPath,
      scope: "conversation",
    }),
  ];

  if (targetRoots.sharedPath) {
    cleanupTasks.push(
      removeEmptyDirectories({
        basePath: targetRoots.sharedPath,
        scope: "shared",
      })
    );
  }

  await Promise.all(cleanupTasks);

  return plan;
}
