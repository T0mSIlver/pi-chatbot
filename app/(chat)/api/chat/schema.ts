import { z } from "zod";

const textPartSchema = z.object({
  type: z.enum(["text"]),
  text: z.string().min(1).max(2000),
});

const filePartSchema = z.object({
  type: z.enum(["file"]),
  mediaType: z.string().min(1),
  name: z.string().min(1).max(100),
  url: z.string().url(),
});

const partSchema = z.union([textPartSchema, filePartSchema]);

const userMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user"]),
  parts: z.array(partSchema),
});

export const postRequestBodySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  message: userMessageSchema,
  selectedChatModel: z.string(),
});

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
