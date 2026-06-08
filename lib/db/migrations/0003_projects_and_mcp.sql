DROP TABLE IF EXISTS "ChatMcpServerOverride";
DROP TABLE IF EXISTS "ProjectMcpServer";
DROP TABLE IF EXISTS "McpConfig";
DROP TABLE IF EXISTS "Chat";
DROP TABLE IF EXISTS "Project";

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
  "summary" text,
  "projectId" uuid REFERENCES "Project"("id") ON DELETE cascade,
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE cascade,
  "workspacePath" text NOT NULL,
  "piSessionFilePath" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "McpConfig" (
  "userId" uuid PRIMARY KEY NOT NULL REFERENCES "User"("id") ON DELETE cascade,
  "json" text NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ProjectMcpServer" (
  "projectId" uuid NOT NULL REFERENCES "Project"("id") ON DELETE cascade,
  "serverId" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("projectId", "serverId")
);

CREATE TABLE IF NOT EXISTS "ChatMcpServerOverride" (
  "chatId" uuid NOT NULL REFERENCES "Chat"("id") ON DELETE cascade,
  "serverId" text NOT NULL,
  "state" text NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("chatId", "serverId")
);
