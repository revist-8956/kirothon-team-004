import { DateTime } from "luxon";

import type { NotificationRecord, RepositoryUnitOfWork } from "./repositories";
import { toScheduleSpec } from "./notification-reservations";
import {
  decideGroupRecipients,
  decidePersonalRecipients,
  type RecipientSnapshotDecision,
} from "../domain/recipients";
import { SCHEDULE_TIMEZONE, calculateDueSlots, type DueSlot } from "../domain/schedule";

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
