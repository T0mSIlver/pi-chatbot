import "server-only";

import type { PiStreamEvent } from "@/lib/pi/events";
import { applyPiStreamEventToMessages } from "@/lib/pi/stream-state";
import type {
  ChatMessage,
  ChatStatus,
  WorkspaceDisplayIntent,
} from "@/lib/types";

const TERMINAL_RUN_CLEANUP_MS = 30_000;

type ChatRunSubscriber = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
};

export type ChatRun = {
  readonly abortSignal: AbortSignal;
  readonly assistantMessageId: string;
  readonly chatId: string;
  readonly isActive: boolean;
  readonly isStopRequested: boolean;
  emit: (event: PiStreamEvent) => void;
  stop: () => void;
  toReadableStream: () => ReadableStream<Uint8Array>;
};

type InternalChatRun = ChatRun & {
  readonly isTerminal: boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var __piChatRuns: Map<string, InternalChatRun> | undefined;
}

const runs = globalThis.__piChatRuns ?? new Map<string, InternalChatRun>();
globalThis.__piChatRuns = runs;

function writeNdjson(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: PiStreamEvent
) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

class InMemoryChatRun implements InternalChatRun {
  readonly abortController = new AbortController();
  readonly assistantMessageId: string;
  readonly chatId: string;
  private latestWorkspaceDisplayIntent: WorkspaceDisplayIntent | null = null;
  private messages: ChatMessage[];
  private status: ChatStatus = "submitted";
  private stopRequested = false;
  private readonly subscribers = new Set<ChatRunSubscriber>();
  private terminal = false;

  constructor({
    assistantMessageId,
    chatId,
    initialMessages,
  }: {
    assistantMessageId: string;
    chatId: string;
    initialMessages: ChatMessage[];
  }) {
    this.assistantMessageId = assistantMessageId;
    this.chatId = chatId;
    this.messages = initialMessages;
  }

  get abortSignal() {
    return this.abortController.signal;
  }

  get isActive() {
    return !this.terminal && ["submitted", "streaming"].includes(this.status);
  }

  get isStopRequested() {
    return this.stopRequested;
  }

  get isTerminal() {
    return this.terminal;
  }

  emit(event: PiStreamEvent) {
    if (this.terminal && event.type !== "snapshot") {
      return;
    }

    this.applyEvent(event);

    for (const subscriber of [...this.subscribers]) {
      try {
        writeNdjson(subscriber.controller, subscriber.encoder, event);
      } catch {
        this.subscribers.delete(subscriber);
      }
    }

    if (["done", "error", "stopped"].includes(event.type)) {
      this.markTerminal();
    }
  }

  stop() {
    if (this.terminal) {
      return;
    }

    this.stopRequested = true;
    this.abortController.abort();
    this.emit({ type: "stopped" });
  }

  toReadableStream() {
    let subscriber: ChatRunSubscriber | null = null;

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        subscriber = { controller, encoder: new TextEncoder() };
        this.subscribers.add(subscriber);

        try {
          writeNdjson(
            controller,
            subscriber.encoder,
            this.createSnapshotEvent()
          );
        } catch {
          this.subscribers.delete(subscriber);
          return;
        }

        if (this.terminal) {
          this.subscribers.delete(subscriber);
          controller.close();
        }
      },
      cancel: () => {
        if (subscriber) {
          this.subscribers.delete(subscriber);
          subscriber = null;
        }
      },
    });
  }

  private applyEvent(event: PiStreamEvent) {
    if (event.type === "snapshot") {
      this.messages = event.messages;
      this.status = event.status;
      this.latestWorkspaceDisplayIntent =
        event.latestWorkspaceDisplayIntent ?? null;
      return;
    }

    if (event.type === "workspace-display") {
      this.latestWorkspaceDisplayIntent = event.intent;
      return;
    }

    if (event.type === "tool-end" && event.displayIntent) {
      this.latestWorkspaceDisplayIntent = event.displayIntent;
    }

    if (event.type === "done") {
      this.status = "ready";
    } else if (event.type === "error") {
      this.status = "error";
    } else if (event.type === "stopped") {
      this.status = "ready";
    } else if (event.type !== "title") {
      this.status = "streaming";
    }

    this.messages = applyPiStreamEventToMessages({
      assistantMessageId: this.assistantMessageId,
      event,
      messages: this.messages,
    });
  }

  private createSnapshotEvent(): PiStreamEvent {
    return {
      type: "snapshot",
      latestWorkspaceDisplayIntent: this.latestWorkspaceDisplayIntent,
      messages: this.messages,
      status: this.status,
    };
  }

  private markTerminal() {
    if (this.terminal) {
      return;
    }

    this.terminal = true;
    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber.controller.close();
      } catch {
        // The subscriber may already be gone.
      }
    }
    this.subscribers.clear();

    setTimeout(() => {
      if (runs.get(this.chatId) === this) {
        runs.delete(this.chatId);
      }
    }, TERMINAL_RUN_CLEANUP_MS);
  }
}

export function startChatRun({
  assistantMessageId,
  chatId,
  initialMessages,
  producer,
}: {
  assistantMessageId: string;
  chatId: string;
  initialMessages: ChatMessage[];
  producer: (run: ChatRun) => Promise<void>;
}) {
  const existingRun = runs.get(chatId);

  if (existingRun?.isActive) {
    return null;
  }

  if (existingRun) {
    runs.delete(chatId);
  }

  const run = new InMemoryChatRun({
    assistantMessageId,
    chatId,
    initialMessages,
  });
  runs.set(chatId, run);

  queueMicrotask(() => {
    producer(run)
      .catch((error) => {
        if (run.isStopRequested) {
          run.emit({ type: "stopped" });
          return;
        }

        run.emit({
          type: "error",
          message:
            error instanceof Error ? error.message : "Pi failed to respond.",
        });
      })
      .finally(() => {
        if (!run.isTerminal) {
          run.emit({ type: "done" });
        }
      });
  });

  return run;
}

export function getActiveChatRun(chatId: string) {
  const run = runs.get(chatId);
  return run?.isActive ? run : null;
}

export function stopChatRun(chatId: string) {
  const run = runs.get(chatId);
  if (!run?.isActive) {
    return false;
  }

  run.stop();
  return true;
}
