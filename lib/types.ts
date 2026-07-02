import { z } from "zod";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { Suggestion } from "@/lib/db/schema";

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
  parentId: z.string().nullable().optional(),
  checkpointId: z.string().optional(),
  // Set when this assistant turn ended abnormally (process restart / error) and
  // is being surfaced from a run's checkpointed partial rather than the
  // completed transcript.
  interrupted: z.boolean().optional(),
  providerRequestIndex: z.number().optional(),
  providerStats: z
    .object({
      generatedTokens: z.number().optional(),
      generationTimeMs: z.number().optional(),
      generationTokensPerSecond: z.number().optional(),
      promptTimeMs: z.number().optional(),
      promptTokens: z.number().optional(),
      promptTokensPerSecond: z.number().optional(),
    })
    .optional(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

export type ProviderTokenStats = NonNullable<MessageMetadata["providerStats"]>;

export type ChatStatus = "ready" | "submitted" | "streaming" | "error";

export type TextUIPart = {
  type: "text";
  text: string;
};

export type ReasoningUIPart = {
  type: "reasoning";
  text: string;
  state?: "streaming" | "done";
};

export type FileUIPart = {
  type: "file";
  url: string;
  mediaType: string;
  name?: string;
  filename?: string;
};

export type WorkspaceScope = "conversation" | "shared";

export type WorkspaceFileKind =
  | "text"
  | "code"
  | "markdown"
  | "image"
  | "csv"
  | "html_app"
  | "binary";

export type WorkspaceDisplayIntent = {
  type: "workspace-file";
  chatId: string;
  scope: WorkspaceScope;
  path: string;
  title?: string;
  mode?: "auto" | "text" | "code" | "markdown" | "image" | "csv" | "html_app";
  line?: number;
};

export type WorkspaceChangeKind = "created" | "modified" | "deleted";

export type WorkspaceFileNode = {
  name: string;
  path: string;
  scope: WorkspaceScope;
  kind: "directory" | "file";
  fileKind?: WorkspaceFileKind;
  size?: number;
  mtime?: string;
  children?: WorkspaceFileNode[];
};

export type WorkspaceChange = {
  path: string;
  scope: WorkspaceScope;
  change: WorkspaceChangeKind;
  fileKind?: WorkspaceFileKind;
  size?: number;
  mtime?: string;
};

export type PiToolUIPart = {
  type: "tool-pi";
  toolCallId: string;
  toolName: string;
  state:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error";
  input?: unknown;
  inputText?: string;
  output?: unknown;
  displayIntent?: WorkspaceDisplayIntent;
  errorText?: string;
  isError?: boolean;
};

export type ChatMessagePart =
  | TextUIPart
  | ReasoningUIPart
  | FileUIPart
  | PiToolUIPart;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: ChatMessagePart[];
  metadata?: MessageMetadata;
};

export type SendMessage = (
  message: {
    id?: string;
    role: "user";
    parts: ChatMessagePart[];
  },
  options?: {
    branchFromEntryId?: string | null;
    onAccepted?: () => void;
    replaceFromMessageId?: string;
    restoreCheckpointId?: string;
  }
) => Promise<boolean>;

export type SetMessages = (
  messages: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[])
) => void;

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  "chat-title": string;
};

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
};
