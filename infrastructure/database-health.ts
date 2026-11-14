import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { prisma } from "./db";

export type ReadinessResult =
  | { ready: true }
  | { ready: false; reason: "DATABASE_UNAVAILABLE" | "MIGRATION_INCOMPATIBLE" };

export interface DatabaseHealthChecks {
  ping(): Promise<void>;
  appliedMigrations(): Promise<readonly AppliedMigration[]>;
  expectedMigrations(): Promise<readonly string[]>;
}

export interface AppliedMigration {
  migrationName: string;
  finishedAt: Date | null;
  rolledBackAt: Date | null;
}

export const databaseHealthChecks: DatabaseHealthChecks = {
  async ping() {
    await prisma.$queryRaw`SELECT 1`;
  },
  async appliedMigrations() {
    const relation = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS "exists"
    `;
    if (!relation[0]?.exists) {
      return [];
    }

    return prisma.$queryRaw<Array<AppliedMigration>>`
      SELECT
        migration_name AS "migrationName",
        finished_at AS "finishedAt",
        rolled_back_at AS "rolledBackAt"
      FROM "_prisma_migrations"
    `;
  },
  async expectedMigrations() {
    const migrationsDirectory = join(process.cwd(), "prisma", "migrations");
    try {
      const entries = await readdir(migrationsDirectory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }
      throw error;
    }
  },
};

export async function checkDatabaseReadiness(
  checks: DatabaseHealthChecks = databaseHealthChecks,
  timeoutMs = 2_000,
): Promise<ReadinessResult> {
  try {
    await withTimeout(checks.ping(), timeoutMs);
  } catch {
    return { ready: false, reason: "DATABASE_UNAVAILABLE" };
  }

  try {
    const [expected, applied] = await withTimeout(Promise.all([
      checks.expectedMigrations(),
      checks.appliedMigrations(),
    ]), timeoutMs);
    const successfullyApplied = new Set(
      applied
        .filter((migration) => migration.finishedAt !== null && migration.rolledBackAt === null)
        .map((migration) => migration.migrationName),
    );
    const hasFailedMigration = applied.some(
      (migration) => migration.finishedAt === null && migration.rolledBackAt === null,
    );
    const isCompatible =
      !hasFailedMigration && expected.every((migration) => successfullyApplied.has(migration));

    return isCompatible
      ? { ready: true }
      : { ready: false, reason: "MIGRATION_INCOMPATIBLE" };
  } catch {
    return { ready: false, reason: "MIGRATION_INCOMPATIBLE" };
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("Health check timed out")), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
