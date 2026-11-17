import { describe, expect, it } from "vitest";

import {
  EnvironmentConfigurationError,
  parseEnvironment,
  parseMigrationDatabaseEnvironment,
  parseRuntimeDatabaseEnvironment,
} from "./env";

const pooledDatabaseUrl =
  "postgresql://app.ref:pooled-password@pooler.example.com:6543/postgres?pgbouncer=true";
const directDatabaseUrl = "postgresql://app:direct-password@db.example.com:5432/postgres";

function issuesOf(run: () => unknown): ReadonlyArray<{ path: string; message: string }> {
  try {
    run();
  } catch (error) {
    if (error instanceof EnvironmentConfigurationError) {
      return error.issues;
    }
    throw error;
  }
  return [];
}

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app:password@db.example.com:5432/app?sslmode=require",
  APP_BASE_URL: "https://notify.example.com",
};

describe("parseEnvironment", () => {
  it("parses required settings and applies bounded scheduler defaults", () => {
    const environment = parseEnvironment(validEnvironment);

    expect(environment).toMatchObject({
      NODE_ENV: "production",
      SCHEDULER_ENABLED: true,
      SCHEDULER_POLL_MS: 30_000,
      SCHEDULER_BATCH_SIZE: 50,
      SCHEDULER_LOOKBACK_DAYS: 35,
      LOG_LEVEL: "info",
      PORT: 8080,
    });
  });

  it("rejects insecure production origins without including secret values in the error message", () => {
    const secret = "do-not-expose-this-db-password";
    const issues = issuesOf(() =>
      parseEnvironment({
        ...validEnvironment,
        DATABASE_URL: `postgresql://app:${secret}@db.example.com:5432/app`,
        APP_BASE_URL: "http://notify.example.com",
      }),
    );

    expect(issues).toContainEqual({
      path: "APP_BASE_URL",
      message: "must be an HTTPS URL in production",
    });
    expect(JSON.stringify(issues)).not.toContain(secret);
  });

  it("no longer requires Auth.js secrets because Google OAuth is configured in Supabase", () => {
    expect(() => parseEnvironment(validEnvironment)).not.toThrow();
  });

  it("rejects scheduler values outside their safe bounds", () => {
    expect(() =>
      parseEnvironment({ ...validEnvironment, SCHEDULER_POLL_MS: "4999" }),
    ).toThrow(EnvironmentConfigurationError);
    expect(() =>
      parseEnvironment({ ...validEnvironment, SCHEDULER_BATCH_SIZE: "501" }),
    ).toThrow(EnvironmentConfigurationError);
  });
});

describe("parseRuntimeDatabaseEnvironment", () => {
  it("accepts the pooled runtime URL without requiring the direct migration URL", () => {
    expect(
      parseRuntimeDatabaseEnvironment({ NODE_ENV: "production", DATABASE_URL: pooledDatabaseUrl }),
    ).toEqual({ NODE_ENV: "production", DATABASE_URL: pooledDatabaseUrl });
  });

  it("requires pgbouncer=true on the transaction pooler port and never echoes the URL", () => {
    const withoutFlag = pooledDatabaseUrl.replace("?pgbouncer=true", "");
    const issues = issuesOf(() => parseRuntimeDatabaseEnvironment({ DATABASE_URL: withoutFlag }));

    expect(issues.map((issue) => issue.path)).toEqual(["DATABASE_URL"]);
    expect(JSON.stringify(issues)).not.toContain("pooled-password");
  });

  it("rejects non-PostgreSQL URLs", () => {
    expect(
      issuesOf(() => parseRuntimeDatabaseEnvironment({ DATABASE_URL: "mysql://db.example.com/app" })),
    ).toEqual([expect.objectContaining({ path: "DATABASE_URL" })]);
  });
});

describe("parseMigrationDatabaseEnvironment", () => {
  it("accepts a pooled runtime URL with a separate direct migration URL", () => {
    expect(
      parseMigrationDatabaseEnvironment({
        DATABASE_URL: pooledDatabaseUrl,
        DIRECT_URL: directDatabaseUrl,
      }),
    ).toMatchObject({ DATABASE_URL: pooledDatabaseUrl, DIRECT_URL: directDatabaseUrl });
  });

  it("requires DIRECT_URL", () => {
    expect(
      issuesOf(() => parseMigrationDatabaseEnvironment({ DATABASE_URL: pooledDatabaseUrl })).map(
        (issue) => issue.path,
      ),
    ).toEqual(["DIRECT_URL"]);
  });

  it("rejects a transaction-pooled DIRECT_URL without exposing either connection string", () => {
    const issues = issuesOf(() =>
      parseMigrationDatabaseEnvironment({
        DATABASE_URL: pooledDatabaseUrl,
        DIRECT_URL: pooledDatabaseUrl,
      }),
    );

    expect(issues.map((issue) => issue.path)).toEqual(["DIRECT_URL"]);
    expect(JSON.stringify(issues)).not.toContain("password");
  });
});
