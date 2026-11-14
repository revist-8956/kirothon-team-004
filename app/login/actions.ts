"use server";

import { signIn } from "@/auth";
import { sanitizeReturnTo } from "@/domain/return-to";

/** Starts the only supported Google OAuth flow with a safe post-login path. */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const returnToValue = formData.get("returnTo");
  const returnTo = sanitizeReturnTo(
    typeof returnToValue === "string" ? returnToValue : undefined,
  );

  await signIn("google", { redirectTo: returnTo });
}
