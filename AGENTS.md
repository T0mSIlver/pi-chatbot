# AGENTS.md

Guidance for AI agents (and humans) working in this repo. Keep it short and
factual; add gotchas here when you hit one that cost real time.

## What this is

A Next.js (App Router, turbopack) chat app wrapping the `pi` coding agent
(`@mariozechner/pi-coding-agent` + `pi-mcp-adapter`). Postgres via Drizzle.
Per-conversation workspaces live on disk under `~/.pi-chatbot` (override with
`PI_CHATBOT_HOME`). The hot path for sending a message is
`app/(chat)/api/chat/route.ts` → `lib/pi/session.ts`.

## Commands

- `pnpm dev` — dev server (turbopack).
- `pnpm build` — runs DB migrations then `next build`. **Config/`next.config.ts`
  changes require a full rebuild + restart; dev hot-reload won't pick them up.**
- `pnpm check` / `pnpm fix` — lint (ultracite/biome).
- `pnpm test` — Playwright e2e.
- `pnpm db:migrate` / `db:studio` — Drizzle.

## Gotchas (learned the hard way)

### Packages reached via `require.resolve`/`path.dirname` must be external
If server code resolves a dependency's path at runtime, e.g. in
`lib/pi/session.ts`:
```ts
const adapterPackageJson = require.resolve("pi-mcp-adapter/package.json");
return [path.dirname(adapterPackageJson)];
```
then that package **must** be listed in `serverExternalPackages` in
`next.config.ts`. Otherwise turbopack bundles it and rewrites `require.resolve`
to return a **numeric module id**, so `path.dirname(<number>)` throws
`The "path" argument must be of type string. Received type number (NNNNNN)`.
This only manifests in production builds, never in `dev`/`tsx`. Currently
external: the `@mariozechner/pi-*` packages and `pi-mcp-adapter`.

### Stored workspace paths are absolute — rebase them across machines
`Chat.workspacePath` / `Chat.piSessionFilePath` are stored as absolute paths.
When data moves between machines (e.g. a Mac dev box → a Linux server), those
paths still point at the old home (`/Users/tom/.pi-chatbot/...`) while the
running home is different (`/root/.pi-chatbot/...`). Always pass stored paths
through `rebaseWorkspacePath()` (`lib/pi/workspace.ts`) before using them — it
re-roots from the `workspaces/...` segment onto the current `getPiChatbotHome()`.
Already applied in `getWorkspaceRoots`, the chat send path, and the delete/trash
handler.

### pi entry ids can come back as numbers
`SessionManager.getLeafId()` is typed `string | null`, but legacy session files
can round-trip an all-digit id back as a number (`"00870422"` → `870422`).
`safeCheckpointId` (workspace-checkpoints.ts) and `normalizeEntryIds`
(jsonl.ts) coerce to strings defensively — keep that when touching those paths.

## Debugging the send path

Errors inside `producePiChatRun` are caught and only emitted to the client as a
message string. To see the real server-side stack, watch the app server's
stdout for `[pi chat] producePiChatRun failed:`. Reproducing `createPiSdkSession`
in isolation needs the `react-server`-free path (the modules import
`server-only`); it's usually faster to add temporary breadcrumbs and read the
production logs than to reproduce locally, since several bugs only appear in the
bundled build.
