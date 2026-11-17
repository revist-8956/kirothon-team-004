import { appOriginEnvironmentSchema } from "./app-origin";
import { runtimeDatabaseEnvironmentSchema, schedulerEnvironmentSchema } from "./env";
import { supabasePublicEnvironmentSchema } from "./supabase/public-environment";

export interface EnvironmentIssue {
  readonly path: string;
  readonly message: string;
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

/**
 * Variables the production web server needs at runtime (Task 14.7).
 *
 * The runtime uses only the pooled `DATABASE_URL`; `DIRECT_URL` belongs to
 * the migration job and is deliberately not required here. Google OAuth
 * credentials live in Supabase Auth, so no OAuth secret is read by the app.
 */
export const REQUIRED_RUNTIME_VARIABLES = [
  "DATABASE_URL",
  "APP_BASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

const schemas = [
  runtimeDatabaseEnvironmentSchema,
  appOriginEnvironmentSchema,
  supabasePublicEnvironmentSchema,
  schedulerEnvironmentSchema,
] as const;

/**
 * Checks every runtime setting and returns all problems at once. Issues
 * carry only variable names and rule messages, never the values.
 */
export function findRuntimeEnvironmentIssues(source: EnvironmentSource): EnvironmentIssue[] {
  const issues = new Map<string, EnvironmentIssue>();
  const add = (issue: EnvironmentIssue) => {
    if (!issues.has(issue.path)) {
      issues.set(issue.path, issue);
    }
  };

  // Presence first, so every missing name is reported even when a schema stops early.
  for (const name of REQUIRED_RUNTIME_VARIABLES) {
    const present =
      name === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
        ? Boolean(source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || source.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim())
        : Boolean(source[name]?.trim());
    if (!present) {
      add({ path: name, message: "is required" });
    }
  }
  for (const schema of schemas) {
    const result = schema.safeParse(source);
    if (!result.success) {
      for (const issue of result.error.issues) {
        add({ path: issue.path.join(".") || "(environment)", message: issue.message });
      }
    }
  }
  return [...issues.values()];
}
