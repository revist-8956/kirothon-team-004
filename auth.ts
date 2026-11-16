import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { isBasicEmailFormat, normalizeEmail } from "./domain/email";
import { prisma } from "./infrastructure/db";
import { logger } from "./infrastructure/logger";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Transitional Auth.js configuration (Task 14.2).
 *
 * Application profiles are now keyed by Supabase `auth.users.id`, and the
 * Auth.js adapter tables were removed, so Auth.js no longer creates users or
 * stores sessions. Until the Supabase OAuth callback and session boundary
 * replace this module (Tasks 14.4 and 14.5), a sign-in only resolves an
 * existing profile by normalized Google email and carries its ID in the token.
 * Google is deliberately the sole provider.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  trustHost: true,
  providers: [Google],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  cookies: {
    sessionToken: {
      name: isProduction ? "__Secure-authjs.session-token" : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isProduction,
      },
    },
  },
  callbacks: {
    signIn({ account, profile }) {
      if (account?.provider !== "google") {
        return false;
      }

      const email = typeof profile?.email === "string" ? profile.email : "";
      return profile?.email_verified === true && isBasicEmailFormat(email);
    },
    async jwt({ token, profile }) {
      // `profile` is present only on the sign-in request itself.
      if (profile) {
        const email = typeof profile.email === "string" ? profile.email : "";
        const user = await prisma.user.findUnique({
          where: { emailNormalized: normalizeEmail(email) },
          select: { id: true },
        });
        token.userId = user?.id ?? null;
      }
      return token;
    },
    session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: typeof token.userId === "string" ? token.userId : "",
        },
      };
    },
  },
  events: {
    signIn() {
      logger.info("auth.login.succeeded");
    },
    signOut() {
      logger.info("auth.logout");
    },
  },
});
