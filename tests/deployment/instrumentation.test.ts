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

  it("fails the start with variable names only when the environment is invalid", async () => {
    stubEnvironment({ ...validProduction, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_hidden" });

    await expect(register()).rejects.toThrow("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(testState.startDispatchScheduler).not.toHaveBeenCalled();
    expect(JSON.stringify(testState.loggerError.mock.calls)).not.toContain("sb_secret_hidden");
  });

  it("does nothing outside the production Node.js runtime", async () => {
    stubEnvironment({ NEXT_RUNTIME: "nodejs", NODE_ENV: "test" });
    await register();
    stubEnvironment({ NEXT_RUNTIME: "edge", NODE_ENV: "production" });
    await register();

    expect(testState.startDispatchScheduler).not.toHaveBeenCalled();
  });
});
