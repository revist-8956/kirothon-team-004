import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { createApplicationAuthAdapter } from "./infrastructure/auth-adapter";
import { isBasicEmailFormat } from "./domain/email";
import { prisma } from "./infrastructure/db";
import { logger } from "./infrastructure/logger";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Google is deliberately the sole provider. A database session is used so that
 * signing out revokes the server-side session as well as its browser cookie.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: createApplicationAuthAdapter(prisma),
  session: { strategy: "database" },
  trustHost: true,
  providers: [
    Google({
      allowDangerousEmailAccountLinking: true,
    }),
  ],
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
    session({ session, user }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: user.id,
        },
      };
    },
  },
  events: {
    signIn({ user, isNewUser }) {
      logger.info("auth.login.succeeded", { userId: user.id, isNewUser });
    },
    signOut() {
      logger.info("auth.logout");
    },
  },
});
