import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { DEFAULT_RETURN_TO, sanitizeReturnTo } from "@/domain/return-to";
import { prisma } from "@/infrastructure/db";

export type AuthenticatedUser = {
  readonly id: string;
  readonly nickname: string;
  readonly nicknameRequired: boolean;
};

type RequireUserOptions = {
  /** Profile setup is the sole protected route a user may open before completing a nickname. */
  readonly allowNicknameRequired?: boolean;
};

/**
 * Returns the signed-in application user when the database session is valid.
 * It is the required authentication boundary for protected layouts, queries,
 * and server actions.
 */
export async function getOptionalUser(): Promise<AuthenticatedUser | null> {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      nickname: true,
      nicknameRequired: true,
    },
  });
}

/**
 * Requires an active database session and a completed nickname before a user
 * can enter protected application functionality.
 */
export async function requireUser(
  returnTo: string = DEFAULT_RETURN_TO,
  options: RequireUserOptions = {},
): Promise<AuthenticatedUser> {
  const safeReturnTo = sanitizeReturnTo(returnTo);
  const user = await getOptionalUser();

  if (!user) {
    redirect(`/login?returnTo=${encodeURIComponent(safeReturnTo)}`);
  }

  if (!options.allowNicknameRequired && user.nicknameRequired) {
    redirect(`/profile/setup?returnTo=${encodeURIComponent(safeReturnTo)}`);
  }

  return user;
}
