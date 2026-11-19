// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  startDispatchScheduler: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/infrastructure/scheduler/start", () => ({
  startDispatchScheduler: testState.startDispatchScheduler,
}));
vi.mock("@/infrastructure/logger", () => ({
  logger: { error: testState.loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { register } from "@/instrumentation";

const validProduction = {
  NEXT_RUNTIME: "nodejs",
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://postgres.ref:pw@pooler.example.com:6543/postgres?pgbouncer=true",
  APP_BASE_URL: "https://d277aj369o96rd.cloudfront.net",
  NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
};

describe("instrumentation register", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    testState.startDispatchScheduler.mockClear();
    testState.loggerError.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubEnvironment(values: Record<string, string>) {
    for (const [name, value] of Object.entries(values)) {
      vi.stubEnv(name, value);
    }
  }

  it("starts the scheduler in production when the environment is valid", async () => {
    stubEnvironment(validProduction);

    await register();

    expect(testState.startDispatchScheduler).toHaveBeenCalledOnce();
  });

  it("keeps the server up but logs variable names only and skips the scheduler when the environment is invalid", async () => {
    stubEnvironment({ ...validProduction, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_hidden" });

    await expect(register()).resolves.toBeUndefined();
    expect(testState.startDispatchScheduler).not.toHaveBeenCalled();
    expect(testState.loggerError).toHaveBeenCalledWith("startup.environment_invalid", {
      issues: [expect.objectContaining({ path: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" })],
    });
    expect(JSON.stringify(testState.loggerError.mock.calls)).not.toContain("sb_secret_hidden");
  });

  it("accepts an APP_BASE_URL with a repeated scheme", async () => {
    stubEnvironment({ ...validProduction, APP_BASE_URL: "https://https://d277aj369o96rd.cloudfront.net" });

    await register();

    expect(testState.loggerError).not.toHaveBeenCalled();
    expect(testState.startDispatchScheduler).toHaveBeenCalledOnce();
  });

  it("does nothing outside the production Node.js runtime", async () => {
    stubEnvironment({ NEXT_RUNTIME: "nodejs", NODE_ENV: "test" });
    await register();
    stubEnvironment({ NEXT_RUNTIME: "edge", NODE_ENV: "production" });
    await register();

    expect(testState.startDispatchScheduler).not.toHaveBeenCalled();
  });
});
