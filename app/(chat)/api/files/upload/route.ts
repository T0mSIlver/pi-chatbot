import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";

function createDataUrl({
  content,
  contentType,
}: {
  content: ArrayBuffer;
  contentType: string;
}) {
  return `data:${contentType};base64,${Buffer.from(content).toString("base64")}`;
}

const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= 5 * 1024 * 1024, {
      message: "File size should be less than 5MB",
    })
    .refine((file) => ["image/jpeg", "image/png"].includes(file.type), {
      message: "File type should be JPEG or PNG",
    }),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (request.body === null) {
    return new Response("Request body is empty", { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as Blob;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const validatedFile = FileSchema.safeParse({ file });

    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.errors
        .map((error) => error.message)
        .join(", ");

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const filename = (formData.get("file") as File).name;
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileBuffer = await file.arrayBuffer();
    const dataUrlUpload = {
      url: createDataUrl({ content: fileBuffer, contentType: file.type }),
      pathname: safeName,
      contentType: file.type,
    };

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(dataUrlUpload);
    }

    try {
      const data = await put(`${safeName}`, fileBuffer, {
        access: "public",
      });

      return NextResponse.json(data);
    } catch (_error) {
      return NextResponse.json(dataUrlUpload);
    }
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
