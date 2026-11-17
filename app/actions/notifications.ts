"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { type ActionResult, actionSuccess, mapActionError } from "@/application/action-result";
import { requireUser } from "@/application/authentication";
import { createNotificationDraft } from "@/application/notification-drafts";
import {
  scheduleNotification,
  type ScheduleFieldName,
} from "@/application/notification-reservations";
import type { ScheduleSubmissionResult } from "@/app/notifications/new/schedule/schedule-form";
import { appRoutes } from "@/components/navigation";
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

const scheduleFieldNames: readonly ScheduleFieldName[] = [
  "oneTimeDate",
  "startDate",
  "localTime",
  "weekday",
  "dayOfMonth",
];

/**
 * Reserves the notification for the signed-in user's draft (Task 7.7). The
 * submission is untrusted input and is validated again by the command. On
 * success the user goes to the sent-notifications list.
 */
export async function scheduleNotificationAction(
  submission: unknown,
): Promise<ScheduleSubmissionResult> {
  const user = await requireUser(appRoutes.schedule);
  const requestId = requestIdFromHeaders(await headers());

  try {
    await scheduleNotification(repositories, user.id, submission);
  } catch (error) {
    const result = mapActionError(error, requestId);
    if (result.ok) {
      throw new Error("mapActionError returned success");
    }
    const fieldErrors: Partial<Record<ScheduleFieldName, string>> = {};
    for (const field of scheduleFieldNames) {
      const message = result.fieldErrors?.[field]?.[0];
      if (message) {
        fieldErrors[field] = message;
      }
    }
    return { ok: false, message: result.message, fieldErrors };
  }

  revalidatePath(appRoutes.sent);
  redirect(appRoutes.sent);
}
