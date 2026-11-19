import { describe, expect, it } from "vitest";

import { parseAppOrigin } from "./app-origin";
import { EnvironmentConfigurationError } from "./environment-error";

describe("parseAppOrigin", () => {
  it("returns the configured origin used for the OAuth callback", () => {
    expect(parseAppOrigin({ NODE_ENV: "production", APP_BASE_URL: "https://notify.example.com/" })).toBe(
      "https://notify.example.com",
    );
    expect(parseAppOrigin({ NODE_ENV: "development", APP_BASE_URL: "http://localhost:3000" })).toBe(
      "http://localhost:3000",
    );
  });

  it("collapses a repeated scheme and surrounding spaces from a console copy-paste", () => {
    expect(
      parseAppOrigin({ NODE_ENV: "production", APP_BASE_URL: " https://https://notify.example.com " }),
    ).toBe("https://notify.example.com");
    expect(parseAppOrigin({ NODE_ENV: "production", APP_BASE_URL: "https://https://https://notify.example.com/" })).toBe(
      "https://notify.example.com",
    );
  });

  it.each([
    ["production", "http://notify.example.com"],
    ["production", "https://notify.example.com/app"],
    ["development", "https://user:pass@notify.example.com"],
    ["development", "https://notify.example.com/?next=/inbox"],
    ["development", "ftp://notify.example.com"],
    ["development", undefined],
  ])("rejects %s APP_BASE_URL %j without echoing the value", (NODE_ENV, APP_BASE_URL) => {
    let thrown: unknown;
    try {
      parseAppOrigin({ NODE_ENV, APP_BASE_URL });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EnvironmentConfigurationError);
    expect((thrown as EnvironmentConfigurationError).issues.map((issue) => issue.path)).toContain("APP_BASE_URL");
    if (APP_BASE_URL) {
      expect(JSON.stringify(thrown) + (thrown as Error).message).not.toContain(APP_BASE_URL);
    }
  });
});
