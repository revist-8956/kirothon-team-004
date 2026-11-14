"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { type ActionResult, actionSuccess, mapActionError } from "@/application/action-result";
import { requireUser } from "@/application/authentication";
import {
  addFriend as addFriendCommand,
  type FriendListItem,
} from "@/application/friends";
import { appRoutes } from "@/components/navigation";
import { repositories } from "@/infrastructure/prisma-repositories";
import { requestIdFromHeaders } from "@/infrastructure/request-id";

export type AddFriendState = ActionResult<FriendListItem> | null;

/** Adds an email-addressed friend for the authenticated user and refreshes their list. */
export async function addFriend(
  _previousState: AddFriendState,
  formData: FormData,
): Promise<AddFriendState> {
  const user = await requireUser(appRoutes.friends);
  const email = formData.get("email");

  try {
    const friend = await addFriendCommand(repositories, user.id, {
      email: typeof email === "string" ? email : "",
    });

    revalidatePath(appRoutes.friends);
    return actionSuccess(friend, "친구를 추가했어요.");
  } catch (error) {
    return mapActionError(error, requestIdFromHeaders(await headers()));
  }
}
