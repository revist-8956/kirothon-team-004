import { describe, expect, it } from "vitest";

import {
  checkDatabaseReadiness,
  type AppliedMigration,
  type DatabaseHealthChecks,
} from "./database-health";

function checks(options: {
  ping?: () => Promise<void>;
  expected?: readonly string[];
  applied?: readonly AppliedMigration[];
} = {}): DatabaseHealthChecks {
  return {
    ping: options.ping ?? (async () => undefined),
    expectedMigrations: async () => options.expected ?? [],
    appliedMigrations: async () => options.applied ?? [],
  };
}

describe("checkDatabaseReadiness", () => {
  it("is ready when the database responds and every local migration succeeded", async () => {
    const result = await checkDatabaseReadiness(
      checks({
        expected: ["202603150001_initial"],
        applied: [
          {
            migrationName: "202603150001_initial",
            finishedAt: new Date(),
            rolledBackAt: null,
          },
        ],
      }),
    );

    expect(result).toEqual({ ready: true });
  });

  it("reports database unavailability without returning the underlying error", async () => {
    const result = await checkDatabaseReadiness(
      checks({
        ping: async () => {
          throw new Error("password authentication failed for admin-secret");
        },
      }),
    );

    expect(result).toEqual({ ready: false, reason: "DATABASE_UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toContain("admin-secret");
  });

  it("is not ready when a required migration is missing or failed", async () => {
    const missing = await checkDatabaseReadiness(
      checks({ expected: ["202603150001_initial"] }),
    );
    const failed = await checkDatabaseReadiness(
      checks({
        applied: [
          {
            migrationName: "202603150001_initial",
            finishedAt: null,
            rolledBackAt: null,
          },
        ],
      }),
    );

    expect(missing).toEqual({ ready: false, reason: "MIGRATION_INCOMPATIBLE" });
    expect(failed).toEqual({ ready: false, reason: "MIGRATION_INCOMPATIBLE" });
  });

  it("fails a database ping that exceeds the readiness deadline", async () => {
    const result = await checkDatabaseReadiness(
      checks({ ping: () => new Promise(() => undefined) }),
      5,
    );

    expect(result).toEqual({ ready: false, reason: "DATABASE_UNAVAILABLE" });
  });
});
