import { auth } from "@/app/(auth)/auth";
import { getLatestRunByChatId, markRunInterrupted } from "@/lib/db/queries";
import { getChatRun } from "@/lib/pi/chat-runs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const run = getChatRun(id);

  // A cached run — active or recently terminal — replays its current snapshot
  // (and tails live if still active), so a reconnect just after completion
  // catches up over the live channel instead of racing the persisted transcript.
  if (run) {
    return new Response(run.toReadableStream(), {
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "application/x-ndjson; charset=utf-8",
      },
    });
  }

  // No cached run. If the DB still says 'active', the producing process died
  // between — reconcile so presence reflects reality. Nothing live to stream;
  // the client falls back to the /api/messages snapshot.
  const lastRun = await getLatestRunByChatId({ chatId: id });
  if (lastRun?.status === "active") {
    await markRunInterrupted({ id: lastRun.id });
  }

  return new Response(null, { status: 204 });
}
