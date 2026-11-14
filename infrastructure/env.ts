import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

const integerFromString = (defaultValue: number, minimum: number, maximum: number) =>
  z
    .string()
    .default(String(defaultValue))
    .transform((value, context) => {
      if (!/^\d+$/.test(value)) {
        context.addIssue({ code: "custom", message: "must be an integer" });
        return z.NEVER;
      }

      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
        context.addIssue({
          code: "custom",
          message: `must be between ${minimum} and ${maximum}`,
        });
        return z.NEVER;
      }

      return parsed;
    });

const httpsUrl = z.url().refine((value) => new URL(value).protocol === "https:", {
  message: "must use HTTPS",
});

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z
      .url()
      .refine((value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol), {
        message: "must be a PostgreSQL URL",
      }),
    AUTH_SECRET: z.string().min(32),
    AUTH_GOOGLE_ID: z.string().min(1),
    AUTH_GOOGLE_SECRET: z.string().min(1),
    AUTH_URL: z.url().optional(),
    APP_BASE_URL: z.url(),
    SCHEDULER_ENABLED: booleanFromString,
    SCHEDULER_POLL_MS: integerFromString(30_000, 5_000, 300_000),
    SCHEDULER_BATCH_SIZE: integerFromString(50, 1, 500),
    SCHEDULER_LOOKBACK_DAYS: integerFromString(35, 1, 365),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    PORT: integerFromString(8080, 1, 65_535),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV !== "production") {
      return;
    }

    for (const [field, value] of [
      ["AUTH_URL", environment.AUTH_URL],
      ["APP_BASE_URL", environment.APP_BASE_URL],
    ] as const) {
      const result = httpsUrl.safeParse(value);
      if (!result.success) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "must be an HTTPS URL in production",
        });
      }
    }

    if (environment.AUTH_URL) {
      const authOrigin = new URL(environment.AUTH_URL).origin;
      const appOrigin = new URL(environment.APP_BASE_URL).origin;
      if (authOrigin !== appOrigin) {
        context.addIssue({
          code: "custom",
          path: ["AUTH_URL"],
          message: "must have the same origin as APP_BASE_URL",
        });
      }
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

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

export function parseEnvironment(source: NodeJS.ProcessEnv): Environment {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    throw new EnvironmentConfigurationError(result.error);
  }

  return result.data;
}

let cachedEnvironment: Environment | undefined;

export function getEnvironment(): Environment {
  cachedEnvironment ??= parseEnvironment(process.env);
  return cachedEnvironment;
}

export function resetEnvironmentCacheForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Environment cache can only be reset in tests.");
  }
  cachedEnvironment = undefined;
}
