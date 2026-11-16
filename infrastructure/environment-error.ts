import type { z } from "zod";

/**
 * Configuration failure that only exposes variable names and rule messages.
 * Raw input values (connection strings, keys) are never copied into the error.
 */
export class EnvironmentConfigurationError extends Error {
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(error: z.ZodError) {
    super("애플리케이션 환경 설정이 올바르지 않습니다.");
    this.name = "EnvironmentConfigurationError";
    this.issues = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
  }
}
