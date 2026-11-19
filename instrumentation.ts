/**
 * Runs once when the production Node.js server (`next start`) starts. It
 * does not run in `next dev`, tests, or the Edge runtime. Imports are
 * dynamic so Prisma never enters a non-Node bundle.
 *
 * 1. Checks every runtime setting and logs problems by variable name only.
 *    The server keeps running so `/api/health/live` still answers and the
 *    environment can be fixed with a normal Beanstalk configuration update;
 *    features that need a broken setting fail on their own request.
 * 2. Starts the dispatch scheduler only when the settings are valid.
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
    return;
  }

  const { startDispatchScheduler } = await import("./infrastructure/scheduler/start");
  startDispatchScheduler();
}
