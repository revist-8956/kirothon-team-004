"use server";

import { headers } from "next/headers";

import { type ActionResult, actionSuccess, mapActionError } from "@/application/action-result";
import { requireUser } from "@/application/authentication";
import {
  acceptGroupInvite,
  createGroup,
  leaveGroup,
  setGroupEmailVisibility,
} from "@/application/group-memberships";
import { getInvite, issueInvite } from "@/application/invites";
import { repositories } from "@/infrastructure/prisma-repositories";
import { requestIdFromHeaders } from "@/infrastructure/request-id";

export type GroupActionData = {
  groupId?: string;
  emailVisibility?: "PRIVATE" | "PUBLIC";
  inviteUrl?: string;
  alreadyMember?: boolean;
};

export type GroupActionResult = ActionResult<GroupActionData>;
export type GroupActionState = GroupActionResult | null;

async function actionRequestId(): Promise<string> {
  return requestIdFromHeaders(await headers());
}

/** Creates a group for the authenticated user and records the creator membership. */
export async function createGroupAction(
  _previousState: GroupActionState,
  formData: FormData,
): Promise<GroupActionResult> {
  const user = await requireUser("/groups");
  const requestId = await actionRequestId();

  try {
    const result = await createGroup(repositories, {
      actorId: user.id,
      name: typeof formData.get("name") === "string" ? String(formData.get("name")) : "",
    });

    return actionSuccess({ groupId: result.group.id }, "그룹을 만들었어요.");
  } catch (error) {
    return mapActionError(error, requestId);
  }
}

/** Issues a fresh opaque invitation link only for the authenticated current member. */
export async function issueInviteLinkAction(groupId: string): Promise<GroupActionResult> {
  const user = await requireUser(`/groups/${encodeURIComponent(groupId)}`);
  const requestId = await actionRequestId();

  try {
    const invite = await issueInvite(repositories, { groupId, issuerId: user.id });
    return actionSuccess({ inviteUrl: `/invite/${invite.rawToken}` });
  } catch (error) {
    return mapActionError(error, requestId);
  }
}

/** Updates only the authenticated member's selected group visibility setting. */
export async function setGroupEmailVisibilityAction(
  groupId: string,
  emailVisibility: "PRIVATE" | "PUBLIC",
): Promise<GroupActionResult> {
  const user = await requireUser(`/groups/${encodeURIComponent(groupId)}`);
  const requestId = await actionRequestId();

  try {
    const membership = await setGroupEmailVisibility(repositories, {
      actorId: user.id,
      groupId,
      emailVisibility,
    });
    return actionSuccess(
      { emailVisibility: membership.emailVisibility },
      membership.emailVisibility === "PUBLIC" ? "이메일을 공개해요." : "이메일을 비공개로 했어요.",
    );
  } catch (error) {
    return mapActionError(error, requestId);
  }
}

/** Ends the authenticated member's membership only after the dialog confirmation. */
export async function leaveGroupAction(groupId: string): Promise<GroupActionResult> {
  const user = await requireUser(`/groups/${encodeURIComponent(groupId)}`);
  const requestId = await actionRequestId();

  try {
    await leaveGroup(repositories, { actorId: user.id, groupId, confirmation: true });
    return actionSuccess({}, "그룹에서 탈퇴했어요.");
  } catch (error) {
    return mapActionError(error, requestId);
  }
}

/** Accepts an opaque invitation token after resolving it again on the server. */
export async function acceptInviteAction(rawToken: string): Promise<GroupActionResult> {
  const user = await requireUser(`/invite/${encodeURIComponent(rawToken)}`);
  const requestId = await actionRequestId();

  try {
    const invite = await getInvite(repositories, rawToken, user.id);
    if (!invite) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "유효하지 않은 초대예요.",
        requestId,
      };
    }

    const accepted = await acceptGroupInvite(repositories, {
      actorId: user.id,
      groupId: invite.groupId,
    });
    return actionSuccess(
      { groupId: invite.groupId, alreadyMember: accepted.alreadyMember },
      accepted.alreadyMember ? "이미 이 그룹의 구성원이에요." : "그룹에 가입했어요.",
    );
  } catch (error) {
    return mapActionError(error, requestId);
  }
}
