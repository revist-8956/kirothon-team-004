import type { SchedulerTickSummary } from "../../application/dispatch-scheduler";
import type { Logger } from "../logger";

export interface SchedulerPollerOptions {
  readonly pollMs: number;
  /** Runs one scheduler pass. Its own failures are reported, not thrown, by the poller. */
  readonly tick: () => Promise<SchedulerTickSummary>;
  readonly logger: Logger;
}

export interface SchedulerPoller {
  /** Stops scheduling new ticks and resolves after the running tick ends. */
  stop(): Promise<void>;
}

/**
 * Runs `tick` every `pollMs`. The next tick is scheduled only after the
 * previous one finishes, so ticks never overlap inside one process; other
 * processes are kept apart by the database locks. The timer is unref'd and
 * never keeps the server alive on its own.
 */
export function startSchedulerPoller(options: SchedulerPollerOptions): SchedulerPoller {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let consecutiveFailures = 0;

  const runOnce = async () => {
    try {
      const summary = await options.tick();
      consecutiveFailures = 0;
      if (summary.candidates > 0 || summary.failed > 0) {
        options.logger.info("scheduler.tick", { ...summary });
      }
      if (summary.oldestDueAgeSeconds * 1000 > options.pollMs * 3) {
        options.logger.warn("scheduler.due_backlog", {
          oldestDueAgeSeconds: summary.oldestDueAgeSeconds,
        });
      }
    } catch (error) {
      consecutiveFailures += 1;
      options.logger.error("scheduler.tick_failed", { consecutiveFailures, error });
    }
  };

  const schedule = () => {
    if (stopped) {
      return;
    }
    timer = setTimeout(() => {
      running = runOnce().finally(() => {
        running = undefined;
        schedule();
      });
    }, options.pollMs);
    timer.unref();
  };

  // Catch up immediately after a (re)start instead of waiting one interval.
  running = runOnce().finally(() => {
    running = undefined;
    schedule();
  });

  return {
    async stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
      await running;
    },
  };
}
