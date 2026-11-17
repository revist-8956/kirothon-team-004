import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SchedulerTickSummary } from "../../application/dispatch-scheduler";
import type { Logger } from "../logger";
import { startSchedulerPoller } from "./poller";

const emptySummary: SchedulerTickSummary = {
  candidates: 0,
  sent: 0,
  skipped: 0,
  conflict: 0,
  notDue: 0,
  failed: 0,
  durationMs: 1,
  oldestDueAgeSeconds: 0,
};

function testLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
}

describe("startSchedulerPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks immediately, then once per interval after the previous tick ends", async () => {
    let active = 0;
    let maxActive = 0;
    const tick = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      active -= 1;
      return emptySummary;
    });
    const poller = startSchedulerPoller({ pollMs: 5_000, tick, logger: testLogger() });

    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8_000);
    // The first tick just ended; the next starts one full interval later.
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(maxActive).toBe(1);

    const stopping = poller.stop();
    await vi.advanceTimersByTimeAsync(8_000);
    await stopping;
  });

  it("keeps polling after a failed tick and logs the failure", async () => {
    const logger = testLogger();
    const tick = vi
      .fn<() => Promise<SchedulerTickSummary>>()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue({ ...emptySummary, candidates: 1, sent: 1 });
    const poller = startSchedulerPoller({ pollMs: 5_000, tick, logger });

    await vi.advanceTimersByTimeAsync(0);
    expect(logger.error).toHaveBeenCalledWith("scheduler.tick_failed", expect.objectContaining({ consecutiveFailures: 1 }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith("scheduler.tick", expect.objectContaining({ sent: 1 }));

    await poller.stop();
  });

  it("warns when the oldest due slot is older than three intervals", async () => {
    const logger = testLogger();
    const tick = vi.fn(async () => ({ ...emptySummary, candidates: 1, oldestDueAgeSeconds: 16 }));
    const poller = startSchedulerPoller({ pollMs: 5_000, tick, logger });

    await vi.advanceTimersByTimeAsync(0);
    expect(logger.warn).toHaveBeenCalledWith("scheduler.due_backlog", { oldestDueAgeSeconds: 16 });

    await poller.stop();
  });

  it("stops scheduling ticks and waits for the running tick", async () => {
    let finishTick!: () => void;
    const tick = vi.fn(
      () =>
        new Promise<SchedulerTickSummary>((resolve) => {
          finishTick = () => resolve(emptySummary);
        }),
    );
    const poller = startSchedulerPoller({ pollMs: 5_000, tick, logger: testLogger() });

    let stopped = false;
    const stopping = poller.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    finishTick();
    await stopping;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(1);
  });
});
