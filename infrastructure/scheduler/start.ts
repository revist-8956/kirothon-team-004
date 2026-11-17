import { runSchedulerTick } from "../../application/dispatch-scheduler";
import { parseSchedulerEnvironment } from "../env";
import { logger } from "../logger";
import { repositories } from "../prisma-repositories";
import { startSchedulerPoller, type SchedulerPoller } from "./poller";

const globalForScheduler = globalThis as typeof globalThis & {
  __dispatchSchedulerPoller?: SchedulerPoller;
};

/**
 * Starts the dispatch poller once per process from `SCHEDULER_*` settings.
 * Called by `instrumentation.ts` in the production Node.js runtime only.
 * The global guard prevents a second poller in the same process; running
 * several processes is safe because each slot is confirmed under DB locks.
 */
export function startDispatchScheduler(): void {
  if (globalForScheduler.__dispatchSchedulerPoller) {
    return;
  }

  let settings;
  try {
    settings = parseSchedulerEnvironment(process.env);
  } catch (error) {
    // A bad scheduler setting must not take the web server down with it.
    logger.error("scheduler.config_invalid", { error });
    return;
  }
  if (!settings.SCHEDULER_ENABLED) {
    logger.info("scheduler.disabled");
    return;
  }

  const poller = startSchedulerPoller({
    pollMs: settings.SCHEDULER_POLL_MS,
    logger,
    tick: () =>
      runSchedulerTick(repositories, {
        batchSize: settings.SCHEDULER_BATCH_SIZE,
        lookbackDays: settings.SCHEDULER_LOOKBACK_DAYS,
      }),
  });
  globalForScheduler.__dispatchSchedulerPoller = poller;
  logger.info("scheduler.started", {
    pollMs: settings.SCHEDULER_POLL_MS,
    batchSize: settings.SCHEDULER_BATCH_SIZE,
    lookbackDays: settings.SCHEDULER_LOOKBACK_DAYS,
  });

  // Next.js keeps its own SIGTERM/SIGINT shutdown; this only stops new ticks
  // so no slot transaction starts while the server drains.
  const stop = () => {
    void poller.stop();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
