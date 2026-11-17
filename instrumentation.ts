/**
 * Runs once when the production Node.js server (`next start`) starts. It
 * does not run in `next dev`, tests, or the Edge runtime. Imports are
 * dynamic so Prisma never enters a non-Node bundle.
 *
 * 1. Fails the start when a runtime setting is missing or malformed, logging
 *    only variable names, so a misconfigured instance never serves traffic.
 * 2. Starts the dispatch scheduler.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") {
    return;
  }

  const { findRuntimeEnvironmentIssues } = await import("./infrastructure/runtime-environment");
  const issues = findRuntimeEnvironmentIssues(process.env);
  if (issues.length > 0) {
    const { logger } = await import("./infrastructure/logger");
    logger.error("startup.environment_invalid", { issues });
    throw new Error(
      `Invalid runtime environment: ${issues.map((issue) => issue.path).join(", ")}`,
    );
  }

  const { startDispatchScheduler } = await import("./infrastructure/scheduler/start");
  startDispatchScheduler();
}
