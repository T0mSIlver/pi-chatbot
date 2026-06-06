import { auth } from "@/app/(auth)/auth";
import { getActiveChatRun } from "@/lib/pi/chat-runs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const run = getActiveChatRun(id);

  if (!run) {
    return new Response(null, { status: 204 });
  }

  return new Response(run.toReadableStream(), {
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}
