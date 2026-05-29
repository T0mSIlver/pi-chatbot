DROP TABLE IF EXISTS "Vote_v2";
DROP TABLE IF EXISTS "Stream";
DROP TABLE IF EXISTS "Suggestion";
DROP TABLE IF EXISTS "Document";
DROP TABLE IF EXISTS "Message_v2";
DROP TABLE IF EXISTS "Chat";

CREATE TABLE IF NOT EXISTS "Project" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  "name" text NOT NULL,
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE cascade,
  "workspacePath" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "Chat" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  "title" text NOT NULL,
  "projectId" uuid NOT NULL REFERENCES "Project"("id") ON DELETE cascade,
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE cascade,
  "workspacePath" text NOT NULL,
  "piSessionFilePath" text NOT NULL
);
