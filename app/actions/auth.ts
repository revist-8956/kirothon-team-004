"use server";

import { requireUser } from "@/application/authentication";
import { signOut } from "@/auth";

/** Revokes the current database session and redirects to the Google login page. */
export async function signOutUser(): Promise<never> {
  await requireUser("/inbox", { allowNicknameRequired: true });
  return signOut({ redirectTo: "/login" });
}
