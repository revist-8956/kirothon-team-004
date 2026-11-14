import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter, AdapterUser } from "@auth/core/adapters";
import type { PrismaClient } from "@prisma/client";

import { isBasicEmailFormat, normalizeEmail } from "../domain/email";
import { isValidNickname, normalizeNickname } from "../domain/nickname";

/**
 * Adapts Auth.js persistence to application-specific user invariants.
 *
 * Auth.js treats the provider email as an account lookup key. The application
 * normalizes that key first so a verified Google account is reused regardless
 * of letter case or surrounding whitespace.
 */
export function createApplicationAuthAdapter(prisma: PrismaClient): Adapter {
  const adapter = PrismaAdapter(prisma);

  return {
    ...adapter,
    async getUserByEmail(email) {
      return prisma.user.findUnique({
        where: { emailNormalized: normalizeEmail(email) },
      });
    },
    async createUser(user: AdapterUser) {
      const email = user.email.trim();
      if (!isBasicEmailFormat(email)) {
        throw new Error("Google profile did not contain a valid email address.");
      }

      const nickname = normalizeNickname(user.name ?? "");
      return prisma.user.create({
        data: {
          name: user.name ?? null,
          email,
          emailNormalized: normalizeEmail(email),
          emailVerified: user.emailVerified,
          image: user.image ?? null,
          nickname,
          nicknameRequired: !isValidNickname(nickname),
        },
      });
    },
  };
}
