import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import {
  getSupabasePublicEnvironment,
  type SupabasePublicEnvironment,
} from "./public-environment";

/**
 * Where the server client runs. Server Components cannot write cookies, so
 * session refreshes there are delegated to `proxy.ts`; Server Actions and Route
 * Handlers persist refreshed or cleared auth cookies on the response.
 */
export type SupabaseServerContext = "server-component" | "server-action" | "route-handler";

export interface SupabaseCookieStore {
  getAll(): ReadonlyArray<{ name: string; value: string }>;
  set(name: string, value: string, options: CookieOptions): unknown;
}

export interface SupabaseServerClientOptions {
  environment?: SupabasePublicEnvironment;
  /** Overrides the HTTP transport to the Supabase Auth API (used to isolate tests). */
  fetch?: typeof fetch;
}

export function createSupabaseServerClientForCookies(
  cookieStore: SupabaseCookieStore,
  context: SupabaseServerContext,
  options: SupabaseServerClientOptions = {},
): SupabaseClient {
  const environment = options.environment ?? getSupabasePublicEnvironment();

  return createServerClient(environment.url, environment.publishableKey, {
    ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
    cookies: {
      getAll: () => cookieStore.getAll().map(({ name, value }) => ({ name, value })),
      setAll: (cookiesToSet) => {
        if (context === "server-component") {
          // Read-only render phase: proxy.ts already refreshed the session cookies.
          return;
        }
        for (const { name, value, options: cookieOptions } of cookiesToSet) {
          cookieStore.set(name, value, cookieOptions);
        }
      },
    },
  });
}

/** For Server Components (read-only cookies). */
export async function createSupabaseServerComponentClient(): Promise<SupabaseClient> {
  return createSupabaseServerClientForCookies(await cookies(), "server-component");
}

/** For Server Actions; refreshed or cleared session cookies are written to the response. */
export async function createSupabaseServerActionClient(): Promise<SupabaseClient> {
  return createSupabaseServerClientForCookies(await cookies(), "server-action");
}

/** For Route Handlers (e.g. the OAuth callback); session cookies are written to the response. */
export async function createSupabaseRouteHandlerClient(): Promise<SupabaseClient> {
  return createSupabaseServerClientForCookies(await cookies(), "route-handler");
}
