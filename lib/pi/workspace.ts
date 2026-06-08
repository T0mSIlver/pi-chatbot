import "server-only";

import { mkdir, readlink, rename, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function getPiChatbotHome() {
  return process.env.PI_CHATBOT_HOME ?? path.join(os.homedir(), ".pi-chatbot");
}

export function getUserWorkspaceRoot(userId: string) {
  return path.join(getPiChatbotHome(), "workspaces", userId);
}

/**
 * Workspace/session paths are stored as absolute paths in the DB. When the data
 * is moved between machines (e.g. a Mac dev box -> a Linux server) those stored
 * paths still point at the *old* home (`/Users/tom/.pi-chatbot/...`) while the
 * current home is different (`/root/.pi-chatbot/...`). Re-root any stored path
 * from its `workspaces/...` segment onto the current `getPiChatbotHome()` so the
 * app reads/writes the right tree regardless of where the row was created.
 */
export function rebaseWorkspacePath(storedPath: string) {
  if (!storedPath) {
    return storedPath;
  }

  const home = getPiChatbotHome();
  const resolved = path.resolve(storedPath);

  if (resolved === home || resolved.startsWith(`${home}${path.sep}`)) {
    return storedPath;
  }

  const marker = `${path.sep}workspaces${path.sep}`;
  const index = resolved.indexOf(marker);
  if (index === -1) {
    return storedPath;
  }

  return path.join(home, resolved.slice(index + 1));
}

export function getProjectWorkspacePath(userId: string, projectId: string) {
  return path.join(getUserWorkspaceRoot(userId), projectId);
}

export function getProjectSharedWorkspacePath(
  userId: string,
  projectId: string
) {
  return path.join(getProjectWorkspacePath(userId, projectId), "shared");
}

export function getConversationWorkspacePath({
  userId,
  projectId,
  conversationId,
}: {
  userId: string;
  projectId: string | null;
  conversationId: string;
}) {
  if (!projectId) {
    return path.join(
      getUserWorkspaceRoot(userId),
      "standalone",
      "conversations",
      conversationId
    );
  }

  return path.join(
    getProjectWorkspacePath(userId, projectId),
    "conversations",
    conversationId
  );
}

export async function ensureProjectWorkspace({
  userId,
  projectId,
}: {
  userId: string;
  projectId: string;
}) {
  const projectPath = getProjectWorkspacePath(userId, projectId);
  const sharedPath = getProjectSharedWorkspacePath(userId, projectId);

  await mkdir(sharedPath, { recursive: true });

  return { projectPath, sharedPath };
}

export async function ensureConversationWorkspace({
  userId,
  projectId,
  conversationId,
}: {
  userId: string;
  projectId: string | null;
  conversationId: string;
}) {
  const conversationPath = getConversationWorkspacePath({
    userId,
    projectId,
    conversationId,
  });

  await mkdir(conversationPath, { recursive: true });

  const sharedLinkPath = path.join(conversationPath, "project-shared");

  if (!projectId) {
    await rm(sharedLinkPath, { force: true, recursive: true });
    return { conversationPath, sharedPath: undefined };
  }

  const { sharedPath } = await ensureProjectWorkspace({ userId, projectId });

  try {
    const existingTarget = await readlink(sharedLinkPath);
    if (path.resolve(conversationPath, existingTarget) !== sharedPath) {
      await rm(sharedLinkPath, { force: true, recursive: true });
      await symlink(sharedPath, sharedLinkPath, "dir");
    }
  } catch {
    await rm(sharedLinkPath, { force: true, recursive: true });
    await symlink(sharedPath, sharedLinkPath, "dir");
  }

  return { conversationPath, sharedPath };
}

export async function moveWorkspaceToTrash(workspacePath: string) {
  const root = path.resolve(getPiChatbotHome(), "workspaces");
  const resolvedWorkspace = path.resolve(workspacePath);

  if (!resolvedWorkspace.startsWith(`${root}${path.sep}`)) {
    throw new Error(
      `Refusing to trash path outside workspace root: ${workspacePath}`
    );
  }

  const trashRoot = path.join(getPiChatbotHome(), "trash");
  await mkdir(trashRoot, { recursive: true });

  const destination = path.join(
    trashRoot,
    `${Date.now()}-${path.basename(resolvedWorkspace)}`
  );

  try {
    await rename(resolvedWorkspace, destination);
    return destination;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
