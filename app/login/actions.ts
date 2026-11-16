"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { startGoogleSignIn } from "@/application/google-sign-in";
import { getAppOrigin } from "@/infrastructure/app-origin";
import { logger } from "@/infrastructure/logger";
import { createSupabaseServerClientForCookies } from "@/infrastructure/supabase/server-client";

/** Starts the only supported Google OAuth flow through Supabase with a safe post-login path. */
export async function signInWithGoogle(formData: FormData): Promise<never> {
  const returnToValue = formData.get("returnTo");
  const cookieStore = await cookies();
  const supabase = createSupabaseServerClientForCookies(cookieStore, "server-action");

  const destination = await startGoogleSignIn({
    auth: supabase.auth,
    cookies: cookieStore,
    appOrigin: getAppOrigin(),
    returnTo: typeof returnToValue === "string" ? returnToValue : undefined,
    logger,
  });

  redirect(destination);
}
