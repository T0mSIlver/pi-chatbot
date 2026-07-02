import "server-only";

import { completeSimple } from "@earendil-works/pi-ai/compat";
import {
  buildSessionContext,
  convertToLlm,
  type SessionEntry,
  serializeConversation,
} from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { isTestEnvironment } from "@/lib/constants";
import { createPiModelRegistry, findPiModel } from "./model";
import { withProviderCaptureModel } from "./provider-capture-provider";
import type { ProviderCaptureContext } from "./provider-captures";

const MAX_TRANSCRIPT_CHARS = 12_000;
const METADATA_TIMEOUT_MS = 20_000;

const metadataSchema = z.object({
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(400),
});

export type ConversationMetadata = z.infer<typeof metadataSchema>;

const rawMetadataSchema = z.object({
  title: z.string().optional().catch(""),
  summary: z.string().optional().catch(""),
});

type MetadataLogLevel = "info" | "warn" | "error";

function logConversationMetadata(
  level: MetadataLogLevel,
  event: string,
  details: Record<string, unknown>
) {
  console[level]("[conversation-metadata]", { event, ...details });
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}

function previewText(value: string) {
  return value.length > 1000 ? `${value.slice(0, 1000)}...` : value;
}

function clampTranscript(transcript: string) {
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) {
    return transcript;
  }

  const half = Math.floor(MAX_TRANSCRIPT_CHARS / 2);
  return [
    transcript.slice(0, half),
    "\n\n[...middle of transcript omitted for metadata generation...]\n\n",
    transcript.slice(-half),
  ].join("");
}

function cleanTitle(value: string) {
  return (
    value
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .replace(/^[#*"\s]+/, "")
      .replace(/[".]+$/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 64) || "New conversation"
  );
}

function cleanSummary(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function createMetadataSignal(parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error("Conversation metadata timed out."));
  }, METADATA_TIMEOUT_MS);
  const abortFromParent = () => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

function normalizeMetadata({
  title,
  summary,
}: {
  title: string;
  summary: string;
}): ConversationMetadata {
  const normalized = {
    title: cleanTitle(title),
    summary: cleanSummary(summary),
  };

  return metadataSchema.parse({
    title: normalized.title || "New conversation",
    summary:
      normalized.summary ||
      "The conversation has started and will be summarized after more context.",
  });
}

function parseMetadata(text: string): {
  metadata: ConversationMetadata;
  parser: "json" | "text";
} {
  const unwrapped = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = unwrapped.indexOf("{");
  const end = unwrapped.lastIndexOf("}");
  const jsonText =
    start >= 0 && end >= start ? unwrapped.slice(start, end + 1) : unwrapped;

  try {
    const parsed = rawMetadataSchema.parse(JSON.parse(jsonText));
    return {
      metadata: normalizeMetadata({
        title: parsed.title ?? "",
        summary: parsed.summary ?? "",
      }),
      parser: "json",
    };
  } catch {
    const title =
      unwrapped.match(/(?:^|\n)\s*title\s*[:=-]\s*(.+)/i)?.[1] ??
      unwrapped.split("\n").find((line) => line.trim()) ??
      "New conversation";
    const summary =
      unwrapped.match(/(?:^|\n)\s*summary\s*[:=-]\s*(.+)/i)?.[1] ??
      unwrapped
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(1)
        .join(" ") ??
      "";

    return {
      metadata: normalizeMetadata({ title, summary }),
      parser: "text",
    };
  }
}

function fallbackConversationMetadata(entries: SessionEntry[]) {
  const transcript = serializeConversation(
    convertToLlm(buildSessionContext(entries).messages)
  );
  const firstUserLine =
    transcript
      .split("\n")
      .find((line) => line.startsWith("[User]:"))
      ?.replace("[User]:", "")
      .trim() || "Mock conversation";
  const firstAssistantLine = transcript
    .split("\n")
    .find((line) => line.startsWith("[Assistant]:"))
    ?.replace("[Assistant]:", "")
    .trim();

  return normalizeMetadata({
    title: firstUserLine,
    summary:
      firstAssistantLine ||
      "The conversation has started and will be summarized after more context.",
  });
}

export async function generateConversationMetadata({
  chatId,
  entries,
  providerCapture,
  selectedModelId,
  signal,
}: {
  chatId: string;
  entries: SessionEntry[];
  providerCapture?: ProviderCaptureContext;
  selectedModelId?: string;
  signal?: AbortSignal;
}): Promise<ConversationMetadata | null> {
  const logBase = { chatId, selectedModelId };

  if (entries.length === 0) {
    logConversationMetadata("warn", "skipped_empty_entries", logBase);
    return null;
  }

  if (isTestEnvironment) {
    logConversationMetadata("info", "using_test_fallback", {
      ...logBase,
      entries: entries.length,
    });
    return fallbackConversationMetadata(entries);
  }

  const fallbackMetadata = fallbackConversationMetadata(entries);

  const metadataAbort = createMetadataSignal(signal);

  try {
    const fullTranscript = serializeConversation(
      convertToLlm(buildSessionContext(entries).messages)
    );
    const transcript = clampTranscript(fullTranscript);
    logConversationMetadata("info", "started", {
      ...logBase,
      entries: entries.length,
      parentSignalAborted: Boolean(signal?.aborted),
      transcriptChars: fullTranscript.length,
      clampedTranscriptChars: transcript.length,
      timeoutMs: METADATA_TIMEOUT_MS,
    });

    const { modelRegistry } = createPiModelRegistry();
    const model = findPiModel({ modelRegistry, selectedModelId });

    if (!model) {
      logConversationMetadata("warn", "model_not_found_using_fallback", {
        ...logBase,
        fallbackTitle: fallbackMetadata.title,
      });
      return fallbackMetadata;
    }

    logConversationMetadata("info", "model_selected", {
      ...logBase,
      modelId: model.id,
      modelProvider: model.provider,
      reasoning: Boolean(model.reasoning),
    });

    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      logConversationMetadata("warn", "auth_failed_using_fallback", {
        ...logBase,
        modelId: model.id,
        fallbackTitle: fallbackMetadata.title,
      });
      return fallbackMetadata;
    }

    logConversationMetadata("info", "auth_ok", {
      ...logBase,
      modelId: model.id,
      hasHeaders: Boolean(auth.headers),
    });

    const response = await completeSimple(
      withProviderCaptureModel(model, providerCapture) ?? model,
      {
        systemPrompt:
          "You generate concise metadata for a coding assistant conversation. Return only valid JSON.",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Create metadata for the conversation in <conversation>. Return exactly this JSON shape and nothing else:
{"title":"2-6 words, max 60 characters","summary":"One sentence, max 180 characters"}

Rules:
- Base the title on the user's real task and the assistant's result.
- Do not include prefixes like "Title:".
- Do not mention that this is a chat, conversation, summary, or transcript.
- If the task is only a greeting or too vague, use "New conversation".

<conversation>
${transcript}
</conversation>`,
              },
            ],
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: 384,
        reasoning: model.reasoning ? "minimal" : undefined,
        signal: metadataAbort.signal,
        temperature: 0.1,
      }
    );

    logConversationMetadata("info", "llm_response", {
      ...logBase,
      modelId: model.id,
      stopReason: response.stopReason,
      contentParts: response.content.length,
    });

    if (response.stopReason === "error") {
      logConversationMetadata("warn", "llm_error_stop_using_fallback", {
        ...logBase,
        modelId: model.id,
        fallbackTitle: fallbackMetadata.title,
      });
      return fallbackMetadata;
    }

    const text = response.content
      .filter((part): part is { type: "text"; text: string } => {
        return part.type === "text";
      })
      .map((part) => part.text)
      .join("\n")
      .trim();

    if (!text) {
      logConversationMetadata("warn", "empty_llm_text_using_fallback", {
        ...logBase,
        modelId: model.id,
        fallbackTitle: fallbackMetadata.title,
      });
      return fallbackMetadata;
    }

    logConversationMetadata("info", "raw_llm_text", {
      ...logBase,
      modelId: model.id,
      chars: text.length,
      preview: previewText(text),
    });

    const parsed = parseMetadata(text);
    logConversationMetadata("info", "parsed", {
      ...logBase,
      modelId: model.id,
      parser: parsed.parser,
      title: parsed.metadata.title,
      summaryChars: parsed.metadata.summary.length,
    });

    return parsed.metadata;
  } catch (error) {
    logConversationMetadata("error", "failed_using_fallback", {
      ...logBase,
      error: errorDetails(error),
      fallbackTitle: fallbackMetadata.title,
      metadataSignalAborted: metadataAbort.signal.aborted,
      parentSignalAborted: Boolean(signal?.aborted),
    });
    return fallbackMetadata;
  } finally {
    metadataAbort.dispose();
  }
}
