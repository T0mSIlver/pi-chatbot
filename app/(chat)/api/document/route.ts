import { ChatbotError } from "@/lib/errors";

function disabled() {
  return new ChatbotError(
    "bad_request:document",
    "Artifacts are disabled for Pi-backed conversations."
  ).toResponse();
}

export function GET() {
  return disabled();
}

export function POST() {
  return disabled();
}

export function DELETE() {
  return disabled();
}
