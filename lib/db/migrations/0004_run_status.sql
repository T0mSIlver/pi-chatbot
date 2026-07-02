CREATE TABLE IF NOT EXISTS "Stream" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "chatId" uuid NOT NULL,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "assistantMessageId" uuid,
  "error" text,
  "partial" json,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  "finishedAt" timestamp
);

CREATE INDEX IF NOT EXISTS "Stream_chatId_createdAt_idx" ON "Stream" ("chatId", "createdAt");
