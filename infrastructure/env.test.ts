import { describe, expect, it } from "vitest";

import { EnvironmentConfigurationError, parseEnvironment } from "./env";

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app:password@db.example.com:5432/app?sslmode=require",
  AUTH_SECRET: "a-secure-auth-secret-with-at-least-32-characters",
  AUTH_GOOGLE_ID: "google-client-id",
  AUTH_GOOGLE_SECRET: "google-client-secret",
  AUTH_URL: "https://notify.example.com",
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
    const secret = "do-not-expose-this-google-secret";

    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        AUTH_GOOGLE_SECRET: secret,
        AUTH_URL: "http://notify.example.com",
      }),
    ).toThrow(EnvironmentConfigurationError);

    try {
      parseEnvironment({ ...validEnvironment, AUTH_SECRET: secret.slice(0, 8) });
    } catch (error) {
      expect(String(error)).not.toContain(secret.slice(0, 8));
    }
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
