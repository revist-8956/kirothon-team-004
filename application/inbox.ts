import { z } from "zod";

import { ApplicationError } from "./action-result";
import type { InboxPageRecord, RepositoryUnitOfWork } from "./repositories";

/** Cards shown on `/inbox`; older dispatches stay in the database. */
export const INBOX_CARD_LIMIT = 100;

const CONFIRM_FORBIDDEN_MESSAGE = "이 알림을 확인할 권한이 없어요.";

/**
 * Received dispatch cards for one user (Task 9.1), newest first. Reading
 * never changes any response state (Requirement 13.1).
 */
export function getInbox(repositories: RepositoryUnitOfWork, userId: string): Promise<InboxPageRecord> {
  return repositories.transaction((transaction) =>
    transaction.dispatches.listInboxForRecipient(userId, INBOX_CARD_LIMIT),
  );
}

export interface DispatchConfirmation {
  readonly dispatchId: string;
  readonly confirmedAt: Date;
  /** False when the user had already confirmed this dispatch. */
  readonly firstConfirmation: boolean;
}

/**
 * Records the user's explicit confirmation of one dispatch (Task 9.3).
 *
 * Only a recipient of the dispatch may confirm. For a group dispatch the
 * user must also still be a current member whose latest membership began by
 * the dispatch time; that check runs under the same group lock that leaving
 * a group takes, so "confirm" and "leave" are serialized. The first request
 * stores the transaction time; repeated requests return that first time.
 * A rejected request changes no row.
 */
export async function confirmDispatch(
  repositories: RepositoryUnitOfWork,
  userId: string,
  dispatchIdInput: unknown,
): Promise<DispatchConfirmation> {
  const parsed = z.uuid().safeParse(dispatchIdInput);
  if (!parsed.success) {
    throw new ApplicationError("FORBIDDEN", { message: CONFIRM_FORBIDDEN_MESSAGE });
  }
  const dispatchId = parsed.data;

  return repositories.transaction(async (transaction) => {
    const recipient = await transaction.dispatches.findRecipient(dispatchId, userId);
    const dispatch = recipient ? await transaction.dispatches.findById(dispatchId) : null;
    const notification = dispatch ? await transaction.notifications.findById(dispatch.notificationId) : null;
    if (!recipient || !dispatch || !notification) {
      throw new ApplicationError("FORBIDDEN", { message: CONFIRM_FORBIDDEN_MESSAGE });
    }

    if (notification.mode === "GROUP" && notification.groupId) {
      await transaction.lockGroup(notification.groupId);
      const membership = await transaction.memberships.findCurrent(notification.groupId, userId);
      if (!membership || membership.joinedAt.getTime() > dispatch.sentAt.getTime()) {
        throw new ApplicationError("FORBIDDEN", { message: CONFIRM_FORBIDDEN_MESSAGE });
      }
    }

    const confirmed = await transaction.dispatches.confirmRecipient(dispatchId, userId);
    if (confirmed?.confirmedAt) {
      return { dispatchId, confirmedAt: confirmed.confirmedAt, firstConfirmation: true };
    }
    const existing = await transaction.dispatches.findRecipient(dispatchId, userId);
    if (!existing?.confirmedAt) {
      throw new ApplicationError("CONFLICT");
    }
    return { dispatchId, confirmedAt: existing.confirmedAt, firstConfirmation: false };
  });
}
