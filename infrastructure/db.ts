import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

/**
 * The only path to application tables. Server-only: it connects as the table
 * owner, which bypasses RLS, so callers must authorize with `requireUser()` and
 * resource predicates. See `infrastructure/database-access-boundary.ts`.
 */
export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
