// @vitest-environment node
import { describe, expect, it } from "vitest";

import { findRuntimeEnvironmentIssues } from "./runtime-environment";

const pooledPassword = "pooled-password-value";
const valid = {
  NODE_ENV: "production",
  DATABASE_URL: `postgresql://postgres.ref:${pooledPassword}@pooler.example.com:6543/postgres?pgbouncer=true`,
  APP_BASE_URL: "https://d277aj369o96rd.cloudfront.net",
  NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
};

describe("findRuntimeEnvironmentIssues", () => {
  it("accepts a complete production runtime without the migration-only DIRECT_URL", () => {
    expect(findRuntimeEnvironmentIssues(valid)).toEqual([]);
  });

  it("reports every missing variable by name", () => {
    const paths = findRuntimeEnvironmentIssues({ NODE_ENV: "production" }).map((issue) => issue.path);

    expect(paths).toEqual(
      expect.arrayContaining(["DATABASE_URL", "APP_BASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]),
    );
  });

  it("rejects insecure or server-only values without echoing them", () => {
    const secretKey = "sb_secret_must-not-leak";
    const issues = findRuntimeEnvironmentIssues({
      ...valid,
      DATABASE_URL: `postgresql://postgres.ref:${pooledPassword}@pooler.example.com:6543/postgres`,
      APP_BASE_URL: "http://d277aj369o96rd.cloudfront.net",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secretKey,
      SCHEDULER_POLL_MS: "100",
    });

    expect(issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(["DATABASE_URL", "APP_BASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SCHEDULER_POLL_MS"]),
    );
    const serialized = JSON.stringify(issues);
    expect(serialized).not.toContain(pooledPassword);
    expect(serialized).not.toContain(secretKey);
  });
});
