/**
 * Starts the dispatch scheduler inside the production Node.js server
 * (`next start`). It does not run in `next dev`, tests, or the Edge runtime.
 * The import is dynamic so Prisma never enters a non-Node bundle.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const { startDispatchScheduler } = await import("./infrastructure/scheduler/start");
    startDispatchScheduler();
  }
}
