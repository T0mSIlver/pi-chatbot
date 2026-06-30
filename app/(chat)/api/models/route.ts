import { chatModels, getCapabilities } from "@/lib/ai/models";

export async function GET() {
  const headers = {
    "Cache-Control": "public, max-age=300, s-maxage=300",
  };

  const capabilities = await getCapabilities();

  return Response.json({ capabilities, models: chatModels }, { headers });
}
