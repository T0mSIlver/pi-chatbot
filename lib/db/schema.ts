import type { InferSelectModel } from "drizzle-orm";
import {
  boolean,
  index,
  json,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const user = pgTable("User", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  email: varchar("email", { length: 64 }).notNull(),
  password: varchar("password", { length: 64 }),
  name: text("name"),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  isAnonymous: boolean("isAnonymous").notNull().default(false),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export type User = InferSelectModel<typeof user>;

export const project = pgTable("Project", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  name: text("name").notNull(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  workspacePath: text("workspacePath").notNull(),
});

export type Project = InferSelectModel<typeof project>;

export const chat = pgTable("Chat", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  title: text("title").notNull(),
  summary: text("summary"),
  projectId: uuid("projectId").references(() => project.id, {
    onDelete: "cascade",
  }),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  workspacePath: text("workspacePath").notNull(),
  piSessionFilePath: text("piSessionFilePath").notNull(),
});

export type Chat = InferSelectModel<typeof chat>;

export const mcpConfig = pgTable("McpConfig", {
  userId: uuid("userId")
    .primaryKey()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  json: text("json").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export type McpConfig = InferSelectModel<typeof mcpConfig>;

export const projectMcpServer = pgTable(
  "ProjectMcpServer",
  {
    projectId: uuid("projectId")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    serverId: text("serverId").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.serverId] }),
  })
);

export type ProjectMcpServer = InferSelectModel<typeof projectMcpServer>;

export const chatMcpServerOverride = pgTable(
  "ChatMcpServerOverride",
  {
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    serverId: text("serverId").notNull(),
    state: text("state").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.chatId, table.serverId] }),
  })
);

export type ChatMcpServerOverride = InferSelectModel<
  typeof chatMcpServerOverride
>;

export type DBMessage = {
  id: string;
  chatId: string;
  role: string;
  parts: unknown;
  attachments: unknown;
  createdAt: Date;
};

export type Vote = {
  chatId: string;
  messageId: string;
  isUpvoted: boolean;
};

export type Document = {
  id: string;
  createdAt: Date;
  title: string;
  content: string | null;
  kind: "text" | "code" | "image" | "sheet";
  userId: string;
};

export type Suggestion = {
  id: string;
  documentId: string;
  documentCreatedAt: Date;
  originalText: string;
  suggestedText: string;
  description: string | null;
  isResolved: boolean;
  userId: string;
  createdAt: Date;
};

// A run = one async agent turn. The row is the durable shadow of the in-process
// `InMemoryChatRun` (lib/pi/chat-runs.ts): it lets resume/presence and boot
// reconciliation reason about runs that outlived (or died with) the process.
export type RunStatus =
  | "active"
  | "completed"
  | "aborted"
  | "error"
  | "interrupted";

export const stream = pgTable(
  "Stream",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    // No FK to Chat: a run record is created (onStart) the moment a turn starts,
    // which for a brand-new chat is before the Chat row is lazily persisted by
    // the producer. The shadow table is keyed by chatId but does not need
    // referential integrity; chat deletion cleans up via deleteRunsByChatId.
    chatId: uuid("chatId").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    assistantMessageId: uuid("assistantMessageId"),
    error: text("error"),
    // P3: last checkpointed in-flight assistant message (ChatMessage), so an
    // interrupted run can still surface what it produced. Typed `unknown` here
    // to avoid a schema↔lib/types import cycle; cast at the query/usage edge.
    partial: json("partial"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
    finishedAt: timestamp("finishedAt"),
  },
  (table) => ({
    chatCreatedIdx: index("Stream_chatId_createdAt_idx").on(
      table.chatId,
      table.createdAt
    ),
  })
);

export type Stream = InferSelectModel<typeof stream>;
