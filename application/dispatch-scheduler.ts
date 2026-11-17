import { DateTime } from "luxon";

import type { NotificationRecord, RepositoryUnitOfWork } from "./repositories";
import { toScheduleSpec } from "./notification-reservations";
import {
  decideGroupRecipients,
  decidePersonalRecipients,
  type RecipientSnapshotDecision,
} from "../domain/recipients";
import { SCHEDULE_TIMEZONE, calculateDueSlots, type DueSlot } from "../domain/schedule";
import { logger } from "../infrastructure/logger";

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export interface DueSlotSearchOptions {
  /** How far back missed slots are caught up (design default: 35 days). */
  readonly lookbackDays: number;
  /** Upper bound of slots handled by one tick. */
  readonly batchSize: number;
}

export interface DueSlotCandidate {
  readonly notificationId: string;
  readonly slot: DueSlot;
}

export type DueSlotOutcome =
  | { readonly kind: "SENT"; readonly dispatchId: string; readonly recipientCount: number }
  | { readonly kind: "SKIPPED"; readonly reason: "SENDER_NOT_MEMBER" | "NO_RECIPIENTS" }
  /** Another transaction already committed this slot. */
  | { readonly kind: "ALREADY_CLAIMED" }
  /** Another scheduler holds this notification's lock; a later tick retries. */
  | { readonly kind: "LOCKED" }
  /** The notification was removed or stopped before this slot became due. */
  | { readonly kind: "NOT_DUE" };

/** `@db.Date` value of a KST calendar date. */
function dateColumn(kstDate: string): Date {
  return new Date(`${kstDate}T00:00:00.000Z`);
}

function kstDateOf(instant: Date): string {
  return DateTime.fromJSDate(instant, { zone: SCHEDULE_TIMEZONE }).toISODate()!;
}

function laterOf(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

function earlierOf(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

/**
 * Slots of one notification due in the scheduler window. Slots due at or
 * before the notification was created are never sent, so a recurring
 * notification registered at 10:00 does not catch up today's 09:00 slot.
 * A stopped recurring notification only keeps slots due by `stoppedAt`.
 */
export function dueSlotsForNotification(
  notification: NotificationRecord,
  windowStart: Date,
  now: Date,
): DueSlot[] {
  const from = laterOf(windowStart, notification.createdAt);
  const through = notification.stoppedAt ? earlierOf(now, notification.stoppedAt) : now;
  if (through.getTime() <= from.getTime()) {
    return [];
  }
  return calculateDueSlots(toScheduleSpec(notification), from, through);
}

/**
 * Finds unclaimed due slots across notifications, oldest due first, capped
 * at `batchSize`. `now` should be the database clock; tests pass a fixed one.
 */
export async function findDueSlots(
  repositories: RepositoryUnitOfWork,
  options: DueSlotSearchOptions,
  now?: Date,
): Promise<DueSlotCandidate[]> {
  return repositories.transaction(async (transaction) => {
    const throughInclusive = now ?? (await transaction.now());
    const windowStart = new Date(throughInclusive.getTime() - options.lookbackDays * DAY_MILLISECONDS);
    const notifications = await transaction.notifications.listDueCandidates({
      fromExclusive: windowStart,
      throughInclusive,
      throughKstDate: dateColumn(kstDateOf(throughInclusive)),
    });
    const claimed = new Set(
      (
        await transaction.claims.listClaimedDates(
          notifications.map((notification) => notification.id),
          dateColumn(kstDateOf(windowStart)),
        )
      ).map((claim) => `${claim.notificationId}:${claim.effectiveDate.toISOString().slice(0, 10)}`),
    );

    return notifications
      .flatMap((notification) =>
        dueSlotsForNotification(notification, windowStart, throughInclusive)
          .filter((slot) => !claimed.has(`${notification.id}:${slot.effectiveDate}`))
          .map((slot) => ({ notificationId: notification.id, slot })),
      )
      .sort((left, right) => left.slot.dueAtUtc.getTime() - right.slot.dueAtUtc.getTime())
      .slice(0, options.batchSize);
  });
}

/**
 * Confirms one due slot exactly once (Tasks 8.1, 8.2).
 *
 * One transaction takes the notification's scheduler lock without waiting,
 * re-checks the claim, decides the recipient snapshot, and writes the claim,
 * the dispatch with its sequence and every recipient row. Any failure rolls
 * all of them back, so the next tick sees the slot as unclaimed again.
 *
 * The lock is per notification rather than per (notification, date): the
 * dispatch sequence is "max + 1", so two dates of the same notification must
 * not be confirmed concurrently.
 *
 * Group recipients are read under the group lock that leaving a group also
 * takes, so whichever of "leave" and "dispatch" commits first defines the
 * membership at dispatch time.
 */
export async function processDueSlot(
  repositories: RepositoryUnitOfWork,
  candidate: DueSlotCandidate,
): Promise<DueSlotOutcome> {
  const { notificationId, slot } = candidate;
  const effectiveDate = dateColumn(slot.effectiveDate);

  return repositories.transaction(async (transaction): Promise<DueSlotOutcome> => {
    if (!(await transaction.tryLockNotification(notificationId))) {
      return { kind: "LOCKED" };
    }
    if (await transaction.claims.find(notificationId, effectiveDate)) {
      return { kind: "ALREADY_CLAIMED" };
    }
    const notification = await transaction.notifications.findById(notificationId);
    if (
      !notification ||
      (notification.stoppedAt && slot.dueAtUtc.getTime() > notification.stoppedAt.getTime())
    ) {
      return { kind: "NOT_DUE" };
    }

    let decision: RecipientSnapshotDecision;
    if (notification.mode === "GROUP" && notification.groupId) {
      await transaction.lockGroup(notification.groupId);
      decision = decideGroupRecipients(
        notification.senderId,
        await transaction.memberships.listCurrentMemberProfiles(notification.groupId),
      );
    } else {
      decision = decidePersonalRecipients(
        notification.senderId,
        await transaction.notifications.listPersonalTargetProfiles(notificationId),
      );
    }

    const sourceDates = slot.sourceDates.map(dateColumn);
    if (decision.kind === "SKIP") {
      await transaction.claims.create({
        notificationId,
        effectiveDate,
        sourceDates,
        state: "SKIPPED",
        skipReason: decision.reason,
      });
      return { kind: "SKIPPED", reason: decision.reason };
    }

    const claim = await transaction.claims.create({
      notificationId,
      effectiveDate,
      sourceDates,
      state: "SENT",
    });
    const dispatch = await transaction.dispatches.create({
      notificationId,
      claimId: claim.id,
      sequence: await transaction.dispatches.nextSequence(notificationId),
      // sourceDates are sorted, so the first is the earliest scheduled date.
      scheduledDate: sourceDates[0]!,
      effectiveDate,
      sentAt: await transaction.transactionTimestamp(),
    });
    await transaction.dispatches.createRecipients(
      dispatch.id,
      decision.recipients.map((recipient) => ({
        recipientId: recipient.userId,
        recipientNicknameSnapshot: recipient.nickname,
      })),
    );
    return { kind: "SENT", dispatchId: dispatch.id, recipientCount: decision.recipients.length };
  });
}

export interface SchedulerTickOptions extends DueSlotSearchOptions {
  /** Attempts per slot for deadlocks and serialization failures (design: 3). */
  readonly maxAttempts?: number;
  /** Waits before a retry; injectable so tests do not sleep. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface SchedulerTickSummary {
  readonly candidates: number;
  readonly sent: number;
  readonly skipped: number;
  /** Slots another scheduler held or had already confirmed. */
  readonly conflict: number;
  readonly notDue: number;
  readonly failed: number;
  readonly durationMs: number;
  /** Age of the oldest slot found in this tick; 0 when nothing was due. */
  readonly oldestDueAgeSeconds: number;
}

const RETRYABLE_POSTGRES_CODES = new Set(["40001", "40P01"]);

function errorCodes(error: unknown): { code?: string; postgresCode?: string } {
  if (typeof error !== "object" || error === null) {
    return {};
  }
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  const meta = "meta" in error && typeof error.meta === "object" && error.meta !== null ? error.meta : undefined;
  const postgresCode = meta && "code" in meta && typeof meta.code === "string" ? meta.code : undefined;
  return { code, postgresCode };
}

/** Deadlock or serialization failure: the whole transaction can be retried. */
function isRetryable(error: unknown): boolean {
  const { code, postgresCode } = errorCodes(error);
  return code === "P2034" || (postgresCode !== undefined && RETRYABLE_POSTGRES_CODES.has(postgresCode));
}

/** A unique-constraint race lost to another scheduler. */
function isUniqueConflict(error: unknown): boolean {
  const { code, postgresCode } = errorCodes(error);
  return code === "P2002" || postgresCode === "23505";
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

/**
 * One scheduler pass (Task 8.5). The production poller and test harnesses
 * call the same entry point; tests pass `clock` instead of using DB time.
 *
 * Each slot is its own transaction and error boundary: a failing slot is
 * logged by notification ID and the rest of the batch continues. Deadlocks
 * and serialization failures are retried with jitter up to `maxAttempts`.
 */
export async function runSchedulerTick(
  repositories: RepositoryUnitOfWork,
  options: SchedulerTickOptions,
  clock?: Date,
): Promise<SchedulerTickSummary> {
  const startedAt = Date.now();
  const maxAttempts = options.maxAttempts ?? 3;
  const sleep = options.sleep ?? defaultSleep;
  const candidates = await findDueSlots(repositories, options, clock);
  const counts = { sent: 0, skipped: 0, conflict: 0, notDue: 0, failed: 0 };

  for (const candidate of candidates) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const outcome = await processDueSlot(repositories, candidate);
        if (outcome.kind === "SENT") {
          counts.sent += 1;
          logger.info("scheduler.claim_sent", {
            notificationId: candidate.notificationId,
            dispatchId: outcome.dispatchId,
            recipientCount: outcome.recipientCount,
          });
        } else if (outcome.kind === "SKIPPED") {
          counts.skipped += 1;
          logger.info("scheduler.claim_skipped", {
            notificationId: candidate.notificationId,
            reason: outcome.reason,
          });
        } else if (outcome.kind === "NOT_DUE") {
          counts.notDue += 1;
        } else {
          counts.conflict += 1;
        }
        break;
      } catch (error) {
        if (isUniqueConflict(error)) {
          counts.conflict += 1;
          logger.info("scheduler.claim_conflict", { notificationId: candidate.notificationId });
          break;
        }
        if (isRetryable(error) && attempt < maxAttempts) {
          await sleep(50 * attempt + Math.floor(Math.random() * 50));
          continue;
        }
        counts.failed += 1;
        logger.error("scheduler.slot_failed", {
          notificationId: candidate.notificationId,
          effectiveDate: candidate.slot.effectiveDate,
          attempts: attempt,
          error,
        });
        break;
      }
    }
  }

  const referenceTime = clock?.getTime() ?? startedAt;
  const oldestDue = candidates[0]?.slot.dueAtUtc.getTime();
  return {
    candidates: candidates.length,
    ...counts,
    durationMs: Date.now() - startedAt,
    oldestDueAgeSeconds:
      oldestDue === undefined ? 0 : Math.max(0, Math.floor((referenceTime - oldestDue) / 1000)),
  };
}
