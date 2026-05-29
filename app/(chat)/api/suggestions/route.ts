import { ChatbotError } from "@/lib/errors";

export function GET() {
  return new ChatbotError(
    "bad_request:api",
    "Suggestions are disabled for Pi-backed conversations."
  ).toResponse();
}
