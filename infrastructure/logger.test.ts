import { describe, expect, it } from "vitest";

import { createLogger } from "./logger";

describe("createLogger", () => {
  it("writes structured JSON and redacts secrets, emails, sentences, and error details", () => {
    const lines: string[] = [];
    const secret = "known-client-secret";
    const logger = createLogger({
      minimumLevel: "debug",
      deploymentVersion: "test-version",
      knownSecrets: [secret],
      now: () => new Date("2026-03-15T10:00:00.000Z"),
      writer: (line) => lines.push(line),
    });

    logger.error("request.failed", {
      requestId: "018f47ca-4f65-7c68-8a50-0ab7cc525a11",
      authorization: "Bearer private-access-token",
      inviteToken: "raw-invitation-token-that-must-not-be-logged",
      nested: {
        email: "person@example.com",
        sentence: "민감한 알림 문장",
        detail: `failure for ${secret} at postgresql://user:pass@db/app`,
      },
      error: new Error("SQL failed with password=database-password"),
      level: "debug",
      event: "untrusted.event",
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("private-access-token");
    expect(lines[0]).not.toContain("raw-invitation-token-that-must-not-be-logged");
    expect(lines[0]).not.toContain("person@example.com");
    expect(lines[0]).not.toContain("민감한 알림 문장");
    expect(lines[0]).not.toContain(secret);
    expect(lines[0]).not.toContain("user:pass");
    expect(lines[0]).not.toContain("database-password");

    expect(JSON.parse(lines[0])).toMatchObject({
      timestamp: "2026-03-15T10:00:00.000Z",
      level: "error",
      event: "request.failed",
      deploymentVersion: "test-version",
      authorization: "[REDACTED]",
      inviteToken: "[REDACTED]",
      error: { name: "Error" },
    });
  });

  it("does not write entries below the configured minimum level", () => {
    const lines: string[] = [];
    const logger = createLogger({ minimumLevel: "warn", writer: (line) => lines.push(line) });

    logger.info("ignored");
    logger.warn("retained");

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).event).toBe("retained");
  });
});
