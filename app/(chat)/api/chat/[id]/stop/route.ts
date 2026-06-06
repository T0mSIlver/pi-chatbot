import { auth } from "@/app/(auth)/auth";
import { stopChatRun } from "@/lib/pi/chat-runs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const stopped = stopChatRun(id);

  return Response.json({ stopped });
}
