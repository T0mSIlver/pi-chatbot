// @ts-nocheck
import { mkdirSync } from "node:fs";
import hermesMemory from "pi-hermes-memory/src/index.ts";

// NOTE: this wrapper mutates *process-global* state — it chdir()s so Hermes'
// synchronous project detection (index.ts -> detectProject -> process.cwd())
// resolves the intended project-scoped memory root, and it reads
// PI_CHATBOT_HERMES_PROJECT_CWD, HOME and PI_CODING_AGENT_DIR set by the
// caller. This is only safe because createPiSdkSession loads the extension
// while holding the withExtensionEnvironment() serialization lock, so no two
// sessions bind extensions (or chdir) concurrently. Do not load this outside
// that lock, and keep Hermes' registration synchronous so cwd is restored the
// moment it returns.
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
