import { registerOTel } from "@vercel/otel";

export async function register() {
  registerOTel({ serviceName: "chatbot" });

  // A run row left 'active' cannot have survived this process restart, so flip
  // it to 'interrupted' on boot. Node runtime only (the DB layer is server-only
  // and must not be pulled into the edge bundle); dynamic import keeps it out.
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.POSTGRES_URL) {
    return;
  }

  try {
    const { markActiveRunsInterrupted } = await import("@/lib/db/queries");
    const reconciled = await markActiveRunsInterrupted();
    if (reconciled > 0) {
      console.log(
        `[instrumentation] reconciled ${reconciled} interrupted run(s) on boot`
      );
    }
  } catch (error) {
    console.error("[instrumentation] run reconciliation failed:", error);
  }
}
