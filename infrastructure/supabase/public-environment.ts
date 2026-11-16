import { z } from "zod";

import { EnvironmentConfigurationError } from "../environment-error";

/**
 * Client-safe Supabase settings. This module is imported by the browser client,
 * so it must only reference `NEXT_PUBLIC_*` variables and never server-only
 * names such as `DATABASE_URL`, `DIRECT_URL` or a service role key.
 */

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

function decodeJwtRole(key: string): string | undefined {
  const segments = key.split(".");
  if (segments.length !== 3 || !segments[1]) {
    return undefined;
  }

  try {
    const base64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload: unknown = JSON.parse(atob(padded));
    if (
      payload !== null &&
      typeof payload === "object" &&
      "role" in payload &&
      typeof payload.role === "string"
    ) {
      return payload.role;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

/** Secret (`sb_secret_…`) and legacy `service_role` JWT keys bypass RLS and must stay off the browser. */
export function isServerOnlySupabaseKey(key: string): boolean {
  return key.startsWith("sb_secret_") || decodeJwtRole(key) === "service_role";
}

export const supabasePublicEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalNonEmptyString,
    /** Legacy anon JWT key; used only when the publishable key is not configured. */
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalNonEmptyString,
  })
  .superRefine((environment, context) => {
    const url = new URL(environment.NEXT_PUBLIC_SUPABASE_URL);
    const isLocalHttp =
      environment.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      LOCAL_HOSTNAMES.has(url.hostname);

    if (url.protocol !== "https:" && !isLocalHttp) {
      context.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_SUPABASE_URL"],
        message: "must be an HTTPS URL (HTTP is allowed only for localhost outside production)",
      });
    }

    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      context.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_SUPABASE_URL"],
        message: "must be a project origin without credentials, path, query or fragment",
      });
    }

    const publishableKey =
      environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? environment.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!publishableKey) {
      context.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
        message: "is required (or NEXT_PUBLIC_SUPABASE_ANON_KEY for legacy projects)",
      });
      return;
    }

    for (const field of [
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ] as const) {
      const value = environment[field];
      if (value && isServerOnlySupabaseKey(value)) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "must be a publishable/anon key, not a secret or service role key",
        });
      }
    }
  })
  .transform((environment) => ({
    url: new URL(environment.NEXT_PUBLIC_SUPABASE_URL).origin,
    publishableKey: (environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      environment.NEXT_PUBLIC_SUPABASE_ANON_KEY) as string,
  }));

export type SupabasePublicEnvironment = z.infer<typeof supabasePublicEnvironmentSchema>;

type SupabasePublicEnvironmentSource = Readonly<Record<string, string | undefined>>;

export function parseSupabasePublicEnvironment(
  source: SupabasePublicEnvironmentSource,
): SupabasePublicEnvironment {
  const result = supabasePublicEnvironmentSchema.safeParse(source);
  if (!result.success) {
    throw new EnvironmentConfigurationError(result.error);
  }
  return result.data;
}

/**
 * Next.js inlines `process.env.NEXT_PUBLIC_*` only for literal property access,
 * so each variable is read explicitly instead of passing `process.env` through.
 */
export function readSupabasePublicEnvironmentSource(): SupabasePublicEnvironmentSource {
  return {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function getSupabasePublicEnvironment(): SupabasePublicEnvironment {
  return parseSupabasePublicEnvironment(readSupabasePublicEnvironmentSource());
}
