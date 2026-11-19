import { z } from "zod";

import { EnvironmentConfigurationError } from "./environment-error";

/**
 * Canonical public origin of the deployment. OAuth redirect URLs and the
 * post-login redirect are built from this configured value instead of the
 * request `Host`/`X-Forwarded-Host` headers, so a forged header cannot steer
 * the Supabase `redirect_to` or the callback redirect to another origin.
 */
/**
 * Trims the value and collapses a repeated scheme such as
 * "https://https://host", a copy-paste mistake that is easy to make in the
 * Elastic Beanstalk console and hard to undo there when config updates fail.
 */
export function normalizeAppBaseUrl(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  let normalized = value.trim();
  while (/^https?:\/\/https?:\/\//i.test(normalized)) {
    normalized = normalized.replace(/^https?:\/\//i, "");
  }
  return normalized;
}

export const appOriginEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_BASE_URL: z.preprocess(normalizeAppBaseUrl, z.url()),
  })
  .superRefine((environment, context) => {
    const url = new URL(environment.APP_BASE_URL);
    if (!["https:", "http:"].includes(url.protocol)) {
      context.addIssue({
        code: "custom",
        path: ["APP_BASE_URL"],
        message: "must be an HTTP(S) URL",
      });
      return;
    }
    if (environment.NODE_ENV === "production" && url.protocol !== "https:") {
      context.addIssue({
        code: "custom",
        path: ["APP_BASE_URL"],
        message: "must be an HTTPS URL in production",
      });
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      context.addIssue({
        code: "custom",
        path: ["APP_BASE_URL"],
        message: "must be an origin without credentials, path, query or fragment",
      });
    }
  })
  .transform((environment) => new URL(environment.APP_BASE_URL).origin);

export function parseAppOrigin(source: Readonly<Record<string, string | undefined>>): string {
  const result = appOriginEnvironmentSchema.safeParse(source);
  if (!result.success) {
    throw new EnvironmentConfigurationError(result.error);
  }
  return result.data;
}

export function getAppOrigin(): string {
  return parseAppOrigin({
    NODE_ENV: process.env.NODE_ENV,
    APP_BASE_URL: process.env.APP_BASE_URL,
  });
}
