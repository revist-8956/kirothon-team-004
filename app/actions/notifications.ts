"use server";

import { headers } from "next/headers";

import { type ActionResult, actionSuccess, mapActionError } from "@/application/action-result";
import { requireUser } from "@/application/authentication";
import { createNotificationDraft } from "@/application/notification-drafts";
import { repositories } from "@/infrastructure/prisma-repositories";
import { requestIdFromHeaders } from "@/infrastructure/request-id";

export type CreateNotificationDraftState = ActionResult<{ draftId: string }> | null;

/**
 * Validates the compose step against the current authenticated user's options
 * and stores a short-lived draft for the schedule step.
 */
export async function createNotificationDraftAction(
  _previousState: CreateNotificationDraftState,
  formData: FormData,
): Promise<CreateNotificationDraftState> {
  const user = await requireUser("/notifications/new");
  const requestId = requestIdFromHeaders(await headers());
  const mode = formData.get("mode");
  const sentence = formData.get("sentence");
  const groupIds = formData.getAll("groupId");

  try {
    const draft = await createNotificationDraft(repositories, user.id, {
      sentence: typeof sentence === "string" ? sentence : "",
      mode,
      recipientIds: formData.getAll("recipientIds").filter(
        (value): value is string => typeof value === "string",
      ),
      groupId: groupIds.length === 1 ? groupIds[0] : groupIds,
    });

    return actionSuccess({ draftId: draft.id });
  } catch (error) {
    return mapActionError(error, requestId);
  }
}
