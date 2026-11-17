import { z } from "zod";

import { ApplicationError } from "./action-result";
import type { DeliveryMode, Recurrence, ScheduleKind } from "@prisma/client";

import type {
  DispatchRoundRecord,
  RepositoryUnitOfWork,
  SentNotificationRecord,
} from "./repositories";

/** Cards shown on `/sent`. */
export const SENT_CARD_LIMIT = 100;

export interface StatusRoundOption {
  readonly dispatchId: string;
  readonly sequence: number;
  readonly effectiveDate: string;
  /** False for group rounds sent before the viewer's latest membership began. */
  readonly viewable: boolean;
  /** Counts visible to this viewer; absent for rounds that are not viewable. */
  readonly confirmedCount?: number;
  readonly recipientCount?: number;
}

export interface StatusRecipientRow {
  readonly recipientId: string;
  readonly nickname: string;
  readonly confirmedAt: Date | null;
  readonly isViewer: boolean;
}

export interface SelectedStatusRound {
  readonly dispatchId: string;
  readonly sequence: number;
  readonly effectiveDate: string;
  readonly sentAt: Date;
  readonly confirmedCount: number;
  readonly recipientCount: number;
  readonly recipients: readonly StatusRecipientRow[];
}

export type NotificationStatusView =
  | { readonly kind: "FORBIDDEN" }
  | {
      readonly kind: "VISIBLE";
      readonly notification: {
        readonly id: string;
        readonly sentence: string;
        readonly mode: DeliveryMode;
        readonly groupName: string | null;
        readonly senderNickname: string;
        readonly scheduleKind: ScheduleKind;
        readonly recurrence: Recurrence | null;
        readonly viewerIsSender: boolean;
      };
      readonly rounds: readonly StatusRoundOption[];
      /** "UNAVAILABLE" when the requested round was sent before the viewer joined. */
      readonly selection: "SELECTED" | "UNAVAILABLE" | "NO_ROUNDS";
      readonly selected: SelectedStatusRound | null;
    };

const FORBIDDEN: NotificationStatusView = { kind: "FORBIDDEN" };

/**
 * Response status of one notification for one viewer (Task 10.1).
 *
 * - Personal sender: every round and every recipient.
 * - Personal recipient: only rounds they received, and only their own row.
 * - Group: only a current member; rounds sent before the viewer's latest
 *   membership began are metadata-only and cannot be opened (16.1–16.9).
 *   The sender gets the same membership-based scope.
 * - Anyone else gets FORBIDDEN, without the sentence.
 *
 * Counts for the selected round are computed from the returned rows, so the
 * heading and the list always agree.
 */
export async function getNotificationStatus(
  repositories: RepositoryUnitOfWork,
  viewerId: string,
  notificationIdInput: unknown,
  requestedDispatchId?: string,
): Promise<NotificationStatusView> {
  const notificationId = z.uuid().safeParse(notificationIdInput);
  if (!notificationId.success) {
    return FORBIDDEN;
  }

  return repositories.transaction(async (transaction): Promise<NotificationStatusView> => {
    const notification = await transaction.notifications.findById(notificationId.data);
    if (!notification) {
      return FORBIDDEN;
    }
    const viewerIsSender = notification.senderId === viewerId;
    const allRounds = await transaction.dispatches.listRoundsForNotification(notification.id);

    let rounds: StatusRoundOption[];
    let ownRowsOnly = false;
    const ownResponses = new Map<string, Date | null>();

    if (notification.mode === "GROUP" && notification.groupId) {
      const membership = await transaction.memberships.findCurrent(notification.groupId, viewerId);
      if (!membership) {
        return FORBIDDEN;
      }
      rounds = allRounds.map((round) =>
        round.sentAt.getTime() >= membership.joinedAt.getTime()
          ? viewableRound(round)
          : { dispatchId: round.dispatchId, sequence: round.sequence, effectiveDate: round.effectiveDate, viewable: false },
      );
    } else if (viewerIsSender) {
      rounds = allRounds.map(viewableRound);
    } else {
      // A personal recipient sees only the rounds they received, with their own response.
      for (const round of allRounds) {
        const own = await transaction.dispatches.findRecipient(round.dispatchId, viewerId);
        if (own) {
          ownResponses.set(round.dispatchId, own.confirmedAt);
        }
      }
      if (ownResponses.size === 0) {
        return FORBIDDEN;
      }
      ownRowsOnly = true;
      rounds = allRounds
        .filter((round) => ownResponses.has(round.dispatchId))
        .map((round) => ({
          dispatchId: round.dispatchId,
          sequence: round.sequence,
          effectiveDate: round.effectiveDate,
          viewable: true,
          recipientCount: 1,
          confirmedCount: ownResponses.get(round.dispatchId) ? 1 : 0,
        }));
    }

    const sender = await transaction.users.findById(notification.senderId);
    const group = notification.groupId ? await transaction.groups.findById(notification.groupId) : null;
    const summary = {
      id: notification.id,
      sentence: notification.sentence,
      mode: notification.mode,
      groupName: group?.name ?? null,
      senderNickname: sender?.nickname ?? "",
      scheduleKind: notification.scheduleKind,
      recurrence: notification.recurrence,
      viewerIsSender,
    };

    const requested = requestedDispatchId
      ? rounds.find((round) => round.dispatchId === requestedDispatchId)
      : undefined;
    if (requested && !requested.viewable) {
      return { kind: "VISIBLE", notification: summary, rounds, selection: "UNAVAILABLE", selected: null };
    }
    const target = requested ?? [...rounds].reverse().find((round) => round.viewable);
    if (!target) {
      return {
        kind: "VISIBLE",
        notification: summary,
        rounds,
        selection: rounds.length === 0 ? "NO_ROUNDS" : "UNAVAILABLE",
        selected: null,
      };
    }

    const round = allRounds.find((candidate) => candidate.dispatchId === target.dispatchId)!;
    const responses = await transaction.dispatches.listResponses(round.dispatchId);
    const visibleResponses = ownRowsOnly
      ? responses.filter((response) => response.recipientId === viewerId)
      : responses;
    const recipients = visibleResponses.map((response) => ({
      recipientId: response.recipientId,
      nickname: response.nickname,
      confirmedAt: response.confirmedAt,
      isViewer: response.recipientId === viewerId,
    }));

    return {
      kind: "VISIBLE",
      notification: summary,
      rounds,
      selection: "SELECTED",
      selected: {
        dispatchId: round.dispatchId,
        sequence: round.sequence,
        effectiveDate: round.effectiveDate,
        sentAt: round.sentAt,
        recipientCount: recipients.length,
        confirmedCount: recipients.filter((recipient) => recipient.confirmedAt !== null).length,
        recipients,
      },
    };
  });
}

function viewableRound(round: DispatchRoundRecord): StatusRoundOption {
  return {
    dispatchId: round.dispatchId,
    sequence: round.sequence,
    effectiveDate: round.effectiveDate,
    viewable: true,
    recipientCount: round.recipientCount,
    confirmedCount: round.confirmedCount,
  };
}

/** The sender's notification cards for `/sent` (Task 10.5). */
export function getSentNotifications(
  repositories: RepositoryUnitOfWork,
  senderId: string,
): Promise<readonly SentNotificationRecord[]> {
  return repositories.transaction((transaction) =>
    transaction.notifications.listSentBySender(senderId, SENT_CARD_LIMIT),
  );
}

/**
 * Stops future rounds of the sender's active recurring notification
 * (Task 8.7). Past rounds and responses are kept. Repeating the request
 * returns the original stop time.
 */
export async function stopRecurringNotification(
  repositories: RepositoryUnitOfWork,
  senderId: string,
  notificationIdInput: unknown,
): Promise<{ readonly stoppedAt: Date }> {
  const parsed = z.uuid().safeParse(notificationIdInput);
  if (!parsed.success) {
    throw new ApplicationError("NOT_FOUND");
  }
  return repositories.transaction(async (transaction) => {
    const stopped = await transaction.notifications.stopRecurring(parsed.data, senderId);
    if (stopped?.stoppedAt) {
      return { stoppedAt: stopped.stoppedAt };
    }
    const notification = await transaction.notifications.findById(parsed.data);
    // Another user's notification is reported exactly like a missing one.
    if (!notification || notification.senderId !== senderId) {
      throw new ApplicationError("NOT_FOUND");
    }
    if (notification.scheduleKind !== "RECURRING") {
      throw new ApplicationError("VALIDATION_ERROR", { message: "반복 알림만 중지할 수 있어요." });
    }
    if (!notification.stoppedAt) {
      throw new ApplicationError("CONFLICT");
    }
    return { stoppedAt: notification.stoppedAt };
  });
}
