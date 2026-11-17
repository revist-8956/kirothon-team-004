"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { type ActionResult, actionSuccess, mapActionError } from "@/application/action-result";
import { requireUser } from "@/application/authentication";
import { confirmDispatch } from "@/application/inbox";
import { appRoutes } from "@/components/navigation";
import { repositories } from "@/infrastructure/prisma-repositories";
import { requestIdFromHeaders } from "@/infrastructure/request-id";

export type ConfirmDispatchResult = ActionResult<{ confirmedAt: string }>;

/** Confirms one received dispatch for the signed-in user; repeated calls keep the first time. */
export async function confirmDispatchAction(dispatchId: string): Promise<ConfirmDispatchResult> {
  const user = await requireUser(appRoutes.inbox);
  const requestId = requestIdFromHeaders(await headers());

  try {
    const confirmation = await confirmDispatch(repositories, user.id, dispatchId);
    revalidatePath(appRoutes.inbox);
    return actionSuccess({ confirmedAt: confirmation.confirmedAt.toISOString() });
  } catch (error) {
    return mapActionError(error, requestId);
  }
}
