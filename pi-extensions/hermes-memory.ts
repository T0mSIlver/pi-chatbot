// @ts-nocheck
import { mkdirSync } from "node:fs";
import hermesMemory from "pi-hermes-memory/src/index.ts";

export default async function piChatbotHermesMemory(pi) {
  const projectCwd = process.env.PI_CHATBOT_HERMES_PROJECT_CWD;
  if (!projectCwd) {
    return hermesMemory(pi);
  }

  const previousCwd = process.cwd();
  mkdirSync(projectCwd, { recursive: true });

  try {
    process.chdir(projectCwd);
    return await hermesMemory(pi);
  } finally {
    process.chdir(previousCwd);
  }
}
