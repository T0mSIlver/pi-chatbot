# Async Agent Resumability — Design (P1–P4)

Status: **plan + implementation** · Target: self-hosted persistent Node (`next start` on the
Proxmox host) · Scope: **one user, ≤ 1 active agent at a time**.

> This supersedes the original (pre-`pi-integration`) version of this doc, which described a
> Vercel-AI-SDK + Redis + `resumable-stream` + `Stream`-table design. **That design no longer
> exists in the codebase.** The `pi-integration` merge (commit `d8da62a`) rearchitected the chat
> turn around an in-process control plane and the `@earendil-works/pi-coding-agent` SDK. This doc
> reflects the *current* architecture and the robustness work layered on top of it.

---

## 1. Current architecture (post-merge)

A turn's lifecycle:

1. **Start** — `POST /api/chat` (`app/(chat)/api/chat/route.ts`) calls `startChatRun()`, which
   creates an `InMemoryChatRun` and stores it in a module-global
   `globalThis.__piChatRuns: Map<chatId, run>` (`lib/pi/chat-runs.ts`). Generation
   (`producePiChatRun` → pi `SessionManager`) is kicked off **detached** via `queueMicrotask`, so
   it outlives the POST request. The response is `run.toReadableStream()` — the sender is just the
   *first subscriber*.
2. **Persist** — the pi SDK writes the transcript to a **JSONL session file** on disk
   (`chat.piSessionFilePath`). Postgres holds only chat metadata + that path.
   `GET /api/messages` reads the JSONL back (`readPiSessionMessages`).
3. **Resume / multi-client** — on mount the client fetches `GET /api/chat/[id]/stream`
   (`hooks/use-pi-chat.ts`). That returns the active run as a stream (a full **snapshot** event
   followed by a live tail) or `204` if none is live. `204` → the client renders the JSONL
   snapshot from `/api/messages`.
4. **Stop** — `POST /api/chat/[id]/stop` → `abortController.abort()` → `piSession.abort()`.
   Authoritative server-side.
5. **Single-active** — `startChatRun` returns `null` if a run is already active for the chat →
   `409 conversation_busy`.

What already works (and was broken pre-merge): live resume on reload / second device, authoritative
stop, single-active invariant, producer surviving a disconnected sender, snapshot-on-subscribe
replay. **The remaining gaps are all about state that lives _only_ in process memory.**

---

## 2. Gaps this work closes

| # | Gap | Symptom today |
|---|---|---|
| **P1** | Run state is in-memory only; no durable record, no boot reconciliation. | Node restart mid-run loses the run silently — client shows the transcript at status `ready`, no hint it was interrupted/truncated. |
| **P2** | `getActiveChatRun` excludes terminal runs, so `/stream` returns `204` the instant a run ends; `error`/`stopped` never reach the JSONL. | A client that reconnects a moment after completion (or after an error) sees nothing; error visibility is connection-dependent. |
| **P3** | Streamed text only reaches JSONL at pi message-block boundaries; no app-level checkpoint. | A crash deep into a long answer loses all of it. |
| **P4** | Vestigial old-template infra still in the tree. | `resumable-stream` dep, `useAutoResume` no-op, `createStreamId`/`getStreamIdsByChatId`/`Stream`-type stubs, misleading `maxDuration`. Confuses every future audit. |

Design principles (unchanged): Postgres is the durable shadow; process memory is the live control
plane, never the only record; every terminal state is recorded and surfaced — no silent truncation.

---

## 3. P1 — Durable run record + boot reconciliation

### 3.1 Schema — repurpose `Stream` as the run record

`Stream` is currently a vestigial *type* (the table was dropped in `0001_pi_projects.sql`). Make it
a real table (one row = one run), hand-authored to match the existing migration style.

```
"Stream" (
  id                 uuid PK default gen_random_uuid()
  chatId             uuid NOT NULL → "Chat"(id) ON DELETE CASCADE
  status             varchar NOT NULL default 'active'   -- active|completed|aborted|error|interrupted
  assistantMessageId uuid
  error              text
  partial            json                                -- P3: last checkpointed assistant message
  createdAt          timestamp NOT NULL default now()
  updatedAt          timestamp NOT NULL default now()
  finishedAt         timestamp
)
INDEX Stream_chatId_createdAt_idx ON ("chatId","createdAt")
```

`lib/db/schema.ts`: declare the `stream` `pgTable`, export `Stream = InferSelectModel<…>` and a
`RunStatus` union. Migration: `lib/db/migrations/0004_run_status.sql` (`CREATE TABLE IF NOT EXISTS …`
+ index) and a matching `_journal.json` entry (these migrations are hand-written; `drizzle-kit
generate` is **not** the workflow — there are no snapshots in `meta/`).

### 3.2 Queries (`lib/db/queries.ts`) — replace the two stubs

- `startRunRecord({ id, chatId, assistantMessageId })` — insert `status='active'`.
- `checkpointRunPartial({ id, partial })` — update `partial` + `updatedAt` (P3).
- `markRunTerminal({ id, status, error?, partial? })` — set terminal `status`, `finishedAt`, etc.
- `getLatestRunByChatId({ chatId })` — newest run row or `null`.
- `markActiveRunsInterrupted()` — `UPDATE … SET status='interrupted', finishedAt=now WHERE
  status='active'`; returns count. Used at boot and for lazy reconciliation.

### 3.3 Lifecycle persistence (`lib/pi/run-persistence.ts` + `chat-runs.ts`)

Keep `chat-runs.ts` free of a hard DB import by **injecting** a `RunPersistence` with
`onStart` / `onCheckpoint` / `onTerminal` hooks. A module-singleton implementation
(`createRunPersistence`) owns:

- **Sequencing** — a per-`runId` promise chain so `onTerminal` can never land before `onStart`.
- **Throttling** — `onCheckpoint` is called on every applied event but writes at most ~1×/s.
- **Mapping** — terminal `ChatStatus`/event → `RunStatus` (`done→completed`, `error→error`,
  `stopped→aborted`, finally-fallback → `completed`).

`InMemoryChatRun` gains a `runId`, records the last error message, and invokes the hooks: `onStart`
when the run is created (only for genuinely-new runs, after the busy check), `onCheckpoint` from
`applyEvent`, `onTerminal` once from `markTerminal`. The POST route generates the `runId`, passes it
+ `runPersistence` into `startChatRun`.

### 3.4 Boot reconciliation (`instrumentation.ts`)

In `register()`, guarded by `process.env.NEXT_RUNTIME === 'nodejs'`, call
`markActiveRunsInterrupted()`. Any row left `active` could not have survived the restart. Idempotent;
log the count.

---

## 4. P2 — Serve recently-terminal runs + surface terminal state

- `chat-runs.ts`: add `getChatRun(chatId)` returning the cached run **even if terminal** (within the
  existing 30 s retention). `toReadableStream` already emits the final snapshot then closes for a
  terminal run — so a just-concluded reconnect resolves over the live channel instead of racing the
  JSONL.
- `GET /api/chat/[id]/stream`: use `getChatRun`. If there is **no** cached run, consult
  `getLatestRunByChatId`; if it's stale-`active` (process died), `markRunInterrupted(id)` (scoped to
  that row, not the global boot sweep) and return `204`. (No per-request owner check — kept
  consistent with the sibling `/api/messages` route; single-user deployment.)
- `GET /api/messages`: include presence so clients can render run state without guessing —
  `activeRun: { id, assistantMessageId } | null` and `lastRun: { status, error, finishedAt } | null`.
  Consult the **cached run first** (`getChatRun` — active or recently terminal): if a run is cached,
  its producer lived in this process, so a DB row still reading `active` is just a terminal write in
  flight, not a dead producer. Only when nothing is cached do we read the durable record and, if
  stale-`active`, reconcile *that row* to `interrupted`. This keeps a just-completed answer from
  being briefly mislabeled and avoids racing the terminal write.

---

## 5. P3 — Partial answer durability (no silent truncation)

- The run already assembles the in-flight assistant message in memory. `onCheckpoint` persists that
  message (parts) into `Stream.partial` at ~1×/s; `onTerminal` writes a final partial.
- `GET /api/messages` recovery, **additive and defensive only** (never mutates or reorders the JSONL
  truth): when there is no in-memory run and `lastRun` is `interrupted`/`error`:
  - if the JSONL already contains the assistant message id → tag it `metadata.interrupted` so the UI
    can mark it;
  - else, only if the JSONL transcript already ends with the originating user turn (coherent thread)
    and `partial` has content → append `partial` as a trailing assistant message tagged
    `interrupted`. Otherwise just report `lastRun.status` and let the client show a banner.
- Client: read `activeRun`/`lastRun`; when a turn is `interrupted`/`error` and nothing is live, show
  a subtle "interrupted — regenerate" affordance (regenerate already exists). Never fabricate model
  text.

---

## 6. P4 — Remove dead/misleading infra (behavior-neutral)

In scope (verified unused):

- Drop the `resumable-stream` dependency (no source imports). **Keep `redis`** — `lib/ratelimit.ts`
  uses it.
- Delete the `useAutoResume` no-op stub (`hooks/use-auto-resume.ts`, no importers).
- Delete the `createStreamId` / `getStreamIdsByChatId` stubs (no callers) — superseded by the real
  run queries.
- `maxDuration = 300` (`route.ts`): no-op on `next start`, misleading for the detached-producer
  model. Remove (document that runs are bounded by the model/step loop, not request duration).

**Explicitly out of scope (deferred):** the artifact / `data-stream-provider` / `data-stream-handler`
subsystem. It is still live-wired into `app/(chat)/layout.tsx` and spans many components
(`artifact.tsx`, `document.tsx`, `create-document`, `request-suggestions`, the suggestions route…).
Removing it is unrelated to resumability and risks the build — track it separately.

If a reverse proxy ever fronts the Node server, disable buffering / raise read timeouts for
`/api/chat` and `/api/chat/[id]/stream` so long SSE/NDJSON isn't cut. (No proxy today.)

---

## 7. Failure-mode matrix (after P1–P4)

| Scenario | Before | After |
|---|---|---|
| Reload mid-run | Resumes live (already worked) | Resumes live |
| Second device mid-run | Resumes live (already worked) | Resumes live |
| Reconnect just after completion | `204` → JSONL race | `getChatRun` replays final snapshot |
| Run errors while sender disconnected | Invisible on reconnect | `lastRun.status='error'` + partial surfaced |
| Node restart mid-run | Silent; stuck-looking `ready` | Boot reconcile → `interrupted`; partial shown |
| Long answer crash | Whole answer lost | Last ~1 s checkpoint of partial shown |

---

## 8. Rollout order

P1 (durable record + reconciliation) → P2 (serve terminal runs + presence) → P3 (partial
checkpoint/merge) → P4 (cleanup). Each step leaves the app working. Tests: extend `tests/e2e`
(`api.test.ts`, `chat.test.ts`) to cover busy-409, stop, reconnect-after-done, and a simulated
interrupted run (insert an `active` row with no in-memory run → `/api/messages` reports
`interrupted`).
