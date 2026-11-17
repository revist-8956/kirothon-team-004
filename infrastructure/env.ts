import { z } from "zod";

import { EnvironmentConfigurationError } from "./environment-error";

export { EnvironmentConfigurationError } from "./environment-error";
export {
  getSupabasePublicEnvironment,
  isServerOnlySupabaseKey,
  parseSupabasePublicEnvironment,
  supabasePublicEnvironmentSchema,
  type SupabasePublicEnvironment,
} from "./supabase/public-environment";

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

const nodeEnvironment = z.enum(["development", "test", "production"]).default("development");

const postgresUrl = z
  .url()
  .refine((value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol), {
    message: "must be a PostgreSQL URL",
  });

/** Supabase Supavisor transaction-mode pooler port. */
const SUPABASE_TRANSACTION_POOLER_PORT = "6543";

function validateRuntimeDatabaseUrl(value: string, context: z.RefinementCtx): void {
  const url = new URL(value);
  // Prisma must disable prepared statements behind a transaction-mode pooler.
  if (
    url.port === SUPABASE_TRANSACTION_POOLER_PORT &&
    url.searchParams.get("pgbouncer") !== "true"
  ) {
    context.addIssue({
      code: "custom",
      path: ["DATABASE_URL"],
      message: "must set pgbouncer=true when using the transaction pooler port",
    });
  }
}

/**
 * Server-only runtime connection. The application uses the pooled
 * `DATABASE_URL` and never needs the direct migration connection.
 */
export const runtimeDatabaseEnvironmentSchema = z
  .object({
    NODE_ENV: nodeEnvironment,
    DATABASE_URL: postgresUrl,
  })
  .superRefine((environment, context) => {
    validateRuntimeDatabaseUrl(environment.DATABASE_URL, context);
  });

/**
 * Server-only migration connection. Prisma Migrate resolves both datasource
 * variables, but schema changes are applied through the direct `DIRECT_URL`.
 */
export const migrationDatabaseEnvironmentSchema = z
  .object({
    NODE_ENV: nodeEnvironment,
    DATABASE_URL: postgresUrl,
    DIRECT_URL: postgresUrl,
  })
  .superRefine((environment, context) => {
    validateRuntimeDatabaseUrl(environment.DATABASE_URL, context);

    const directUrl = new URL(environment.DIRECT_URL);
    if (
      directUrl.port === SUPABASE_TRANSACTION_POOLER_PORT ||
      directUrl.searchParams.get("pgbouncer") === "true"
    ) {
      context.addIssue({
        code: "custom",
        path: ["DIRECT_URL"],
        message: "must be a direct (non transaction-pooled) connection for migrations",
      });
    }
  });

export type RuntimeDatabaseEnvironment = z.infer<typeof runtimeDatabaseEnvironmentSchema>;
export type MigrationDatabaseEnvironment = z.infer<typeof migrationDatabaseEnvironmentSchema>;

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export function parseRuntimeDatabaseEnvironment(
  source: EnvironmentSource,
): RuntimeDatabaseEnvironment {
  const result = runtimeDatabaseEnvironmentSchema.safeParse(source);
  if (!result.success) {
    throw new EnvironmentConfigurationError(result.error);
  }
  return result.data;
}

export function parseMigrationDatabaseEnvironment(
  source: EnvironmentSource,
): MigrationDatabaseEnvironment {
  const result = migrationDatabaseEnvironmentSchema.safeParse(source);
  if (!result.success) {
    throw new EnvironmentConfigurationError(result.error);
  }
  return result.data;
}

export const environmentSchema = z
  .object({
    NODE_ENV: nodeEnvironment,
    DATABASE_URL: postgresUrl,
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

    // Google OAuth credentials live in Supabase Auth, not in this app (Task 14.5).
    if (!httpsUrl.safeParse(environment.APP_BASE_URL).success) {
      context.addIssue({
        code: "custom",
        path: ["APP_BASE_URL"],
        message: "must be an HTTPS URL in production",
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

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
