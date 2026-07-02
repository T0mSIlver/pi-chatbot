import { auth } from "@/app/(auth)/auth";
import { listPiSlashCommands } from "@/lib/pi/slash-commands";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const commands = await listPiSlashCommands(id);
    return Response.json({ commands });
  } catch (error) {
    console.error("[pi chat] failed to list slash commands:", error);
    return Response.json({ commands: [] });
  }
}
