"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { type ActionResult, actionSuccess, mapActionError } from "@/application/action-result";
import { requireUser } from "@/application/authentication";
import { stopRecurringNotification } from "@/application/notification-status";
import { appRoutes } from "@/components/navigation";
import { repositories } from "@/infrastructure/prisma-repositories";
import { requestIdFromHeaders } from "@/infrastructure/request-id";

export type StopRecurringResult = ActionResult<{ stoppedAt: string }>;

/** Stops future rounds of the signed-in sender's recurring notification. */
export async function stopRecurringNotificationAction(notificationId: string): Promise<StopRecurringResult> {
  const user = await requireUser(appRoutes.sent);
  const requestId = requestIdFromHeaders(await headers());

  try {
    const { stoppedAt } = await stopRecurringNotification(repositories, user.id, notificationId);
    revalidatePath(appRoutes.sent);
    return actionSuccess({ stoppedAt: stoppedAt.toISOString() }, "반복 알림을 중지했어요.");
  } catch (error) {
    return mapActionError(error, requestId);
  }
}
