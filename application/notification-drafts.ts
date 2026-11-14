import { z } from "zod";

import { ApplicationError } from "./action-result";
import type {
  ComposeFriendOptionRecord,
  GroupListItem,
  NotificationDraftRecord,
  RepositoryUnitOfWork,
} from "./repositories";
import { notificationSentenceSchema } from "../domain/content";

const DRAFT_TTL_MILLISECONDS = 30 * 60 * 1000;
const RECIPIENTS_ERROR_MESSAGE = "수신 대상을 한 명 이상 선택해 주세요.";
const NON_FRIEND_RECIPIENT_ERROR_MESSAGE = "친구가 아닌 사용자는 선택할 수 없어요.";
const GROUP_ACCESS_ERROR_MESSAGE = "선택한 그룹에 알림을 보낼 권한이 없어요.";

const personalDraftSchema = z
  .object({
    sentence: notificationSentenceSchema,
    mode: z.literal("PERSONAL"),
    recipientIds: z.array(z.string().uuid()).min(1, RECIPIENTS_ERROR_MESSAGE),
  })
  .strict();

const groupDraftSchema = z
  .object({
    sentence: notificationSentenceSchema,
    mode: z.literal("GROUP"),
    groupId: z.string().uuid(),
  })
  .strict();

const createNotificationDraftSchema = z.discriminatedUnion("mode", [
  personalDraftSchema,
  groupDraftSchema,
]);

export type CreateNotificationDraftInput = z.input<typeof createNotificationDraftSchema>;

export interface PersonalComposeOptions {
  readonly mode: "PERSONAL";
  readonly recipients: readonly ComposeFriendOptionRecord[];
}

export interface GroupComposeOptions {
  readonly mode: "GROUP";
  readonly groups: readonly GroupListItem[];
}

export type ComposeOptions = PersonalComposeOptions | GroupComposeOptions;

/**
 * Returns only targets the authenticated actor may select for the requested
 * compose mode. The repository applies the ownership/current-membership
 * predicate in the database query rather than trusting a client-side list.
 */
export async function getComposeOptions(
  repositories: RepositoryUnitOfWork,
  actorUserId: string,
  mode: "PERSONAL" | "GROUP",
): Promise<ComposeOptions> {
  return repositories.transaction(async (transaction) => {
    if (mode === "PERSONAL") {
      return {
        mode,
        recipients: await transaction.friends.listComposeOptions(actorUserId),
      };
    }

    return {
      mode,
      groups: await transaction.groups.listCurrentForUser(actorUserId),
    };
  });
}

/**
 * Stores a short-lived, server-authorized compose draft. It deliberately
 * persists only recipient IDs or a single group ID, never user display data.
 * The schedule command must re-check these permissions before consuming it.
 */
export async function createNotificationDraft(
  repositories: RepositoryUnitOfWork,
  actorUserId: string,
  input: unknown,
): Promise<NotificationDraftRecord> {
  const parsed = createNotificationDraftSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApplicationError("VALIDATION_ERROR", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  return repositories.transaction(async (transaction) => {
    const now = await transaction.now();
    const expiresAt = new Date(now.getTime() + DRAFT_TTL_MILLISECONDS);

    if (parsed.data.mode === "PERSONAL") {
      const recipientIds = [...new Set(parsed.data.recipientIds)];
      if (recipientIds.length !== parsed.data.recipientIds.length) {
        throw new ApplicationError("VALIDATION_ERROR", {
          message: RECIPIENTS_ERROR_MESSAGE,
          fieldErrors: { recipientIds: [RECIPIENTS_ERROR_MESSAGE] },
        });
      }

      const friendIds = new Set(await transaction.friends.listFriendIds(actorUserId));
      if (recipientIds.some((recipientId) => !friendIds.has(recipientId))) {
        throw new ApplicationError("FORBIDDEN", { message: NON_FRIEND_RECIPIENT_ERROR_MESSAGE });
      }

      return transaction.drafts.create({
        ownerId: actorUserId,
        sentence: parsed.data.sentence,
        mode: parsed.data.mode,
        targetJson: { recipientIds },
        expiresAt,
      });
    }

    await transaction.lockGroup(parsed.data.groupId);
    const membership = await transaction.memberships.findCurrent(parsed.data.groupId, actorUserId);
    if (!membership) {
      throw new ApplicationError("FORBIDDEN", { message: GROUP_ACCESS_ERROR_MESSAGE });
    }

    return transaction.drafts.create({
      ownerId: actorUserId,
      sentence: parsed.data.sentence,
      mode: parsed.data.mode,
      targetJson: { groupId: parsed.data.groupId },
      expiresAt,
    });
  });
}
