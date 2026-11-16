"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/application/authentication";
import { endSupabaseSession, LOGIN_PATH } from "@/application/google-sign-in";
import { logger } from "@/infrastructure/logger";
import { createSupabaseServerActionClient } from "@/infrastructure/supabase/server-client";

/**
 * Ends the current Supabase session on the server: the session cookies are
 * cleared on this response and the refresh token is revoked, then the user is
 * sent to the Google login page.
 */
export async function signOutUser(): Promise<never> {
  await requireUser("/inbox", { allowNicknameRequired: true });
  const supabase = await createSupabaseServerActionClient();
  await endSupabaseSession(supabase.auth, logger);
  redirect(LOGIN_PATH);
}
