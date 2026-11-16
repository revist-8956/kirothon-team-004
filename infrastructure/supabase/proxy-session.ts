import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { logger as defaultLogger, type Logger } from "../logger";
import {
  readSupabasePublicEnvironmentSource,
  supabasePublicEnvironmentSchema,
} from "./public-environment";

export interface RefreshSupabaseSessionOptions {
  /** Environment variable source; defaults to the `NEXT_PUBLIC_*` values. */
  environmentSource?: Readonly<Record<string, string | undefined>>;
  /** Overrides the HTTP transport to the Supabase Auth API (used to isolate tests). */
  fetch?: typeof fetch;
  logger?: Logger;
}

let reportedConfigurationIssue = false;

/**
 * Refreshes the Supabase session cookie before rendering so Server Components,
 * Server Actions and Route Handlers observe the same, non-expired session.
 *
 * This is not an authorization boundary: it never redirects. Protected routes
 * and actions still verify the user on the server.
 */
export async function refreshSupabaseSession(
  request: NextRequest,
  options: RefreshSupabaseSessionOptions = {},
): Promise<NextResponse> {
  const logger = options.logger ?? defaultLogger;
  let response = NextResponse.next({ request });

  const environment = supabasePublicEnvironmentSchema.safeParse(
    options.environmentSource ?? readSupabasePublicEnvironmentSource(),
  );
  if (!environment.success) {
    // Only the refresh is skipped: protected routes still fail closed in
    // `requireUser()`, while public pages stay reachable.
    if (!reportedConfigurationIssue) {
      reportedConfigurationIssue = true;
      logger.warn("supabase.session.refresh_skipped", {
        reason: "configuration_invalid",
        fields: environment.error.issues.map((issue) => issue.path.join(".")),
      });
    }
    return response;
  }

  const supabase = createServerClient(environment.data.url, environment.data.publishableKey, {
    ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options: cookieOptions } of cookiesToSet) {
          response.cookies.set(name, value, cookieOptions);
        }
        // Cache-Control headers prevent shared caches from storing Set-Cookie responses.
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  try {
    // getClaims validates the JWT and triggers a refresh when the access token expired.
    await supabase.auth.getClaims();
  } catch {
    logger.warn("supabase.session.refresh_failed");
  }

  return response;
}

export function resetSupabaseProxyStateForTests(): void {
  reportedConfigurationIssue = false;
}
