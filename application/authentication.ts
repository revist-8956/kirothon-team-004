import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { ApplicationError } from "@/application/action-result";
import { DEFAULT_RETURN_TO, sanitizeReturnTo } from "@/domain/return-to";
import { prisma } from "@/infrastructure/db";
import { logger } from "@/infrastructure/logger";
import { createSupabaseServerComponentClient } from "@/infrastructure/supabase/server-client";

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
 * Returns the signed-in application user when the Supabase session is valid.
 * It is the required authentication boundary for protected layouts, queries,
 * and server actions.
 *
 * `auth.getUser()` verifies the access token with the Supabase Auth server, so
 * a forged or revoked cookie never yields a user ID. The cookies were already
 * refreshed by `proxy.ts` for both page renders and Server Action requests, so
 * every caller reads the same session without writing cookies here. A session
 * without an application profile is treated as signed out; signing in again
 * prepares the profile in the OAuth callback.
 *
 * A missing, expired or rejected session means "signed out". When the Auth
 * server is unreachable or answers 5xx, the session cannot be verified either
 * way, so this throws `INTERNAL_ERROR` for the route error boundary instead of
 * sending a possibly signed-in user through the login flow. Only the error
 * status is logged, never tokens or cookie values.
 */
export async function getOptionalUser(): Promise<AuthenticatedUser | null> {
  const supabase = await createSupabaseServerComponentClient();
  const { data, error } = await supabase.auth.getUser();
  if (error && isAuthRetryableFetchError(error)) {
    logger.warn("auth.session.verify_unavailable", { status: error.status });
    throw new ApplicationError("INTERNAL_ERROR", { cause: error });
  }
  const userId = error ? undefined : data.user?.id;

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
 * Requires an active Supabase session and a completed nickname before a user
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
