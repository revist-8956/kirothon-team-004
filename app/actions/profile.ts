"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireUser } from "@/application/authentication";
import { type ActionResult } from "@/application/action-result";
import { NICKNAME_ERROR_MESSAGE, nicknameSchema } from "@/domain/nickname";
import { sanitizeReturnTo } from "@/domain/return-to";
import { prisma } from "@/infrastructure/db";
import { requestIdFromHeaders } from "@/infrastructure/request-id";

export type UpdateNicknameState = ActionResult<{ nickname: string }> | null;

/** Saves a valid normalized nickname for the session user and unlocks protected pages. */
export async function updateNickname(
  _previousState: UpdateNicknameState,
  formData: FormData,
): Promise<UpdateNicknameState> {
  const rawReturnTo = formData.get("returnTo");
  const returnTo = sanitizeReturnTo(
    typeof rawReturnTo === "string" ? rawReturnTo : undefined,
  );
  const user = await requireUser(returnTo, { allowNicknameRequired: true });
  const result = nicknameSchema.safeParse(formData.get("nickname"));

  if (!result.success) {
    const requestId = requestIdFromHeaders(await headers());
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: NICKNAME_ERROR_MESSAGE,
      fieldErrors: { nickname: [NICKNAME_ERROR_MESSAGE] },
      requestId,
    };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      nickname: result.data,
      nicknameRequired: false,
    },
  });

  redirect(returnTo);
}
