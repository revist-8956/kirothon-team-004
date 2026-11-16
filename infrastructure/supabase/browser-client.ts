import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicEnvironment } from "./public-environment";

/** Auth-only surface of the browser client. */
export type SupabaseBrowserAuthClient = SupabaseClient["auth"];

/**
 * Browser Supabase access is limited to the auth session (Google OAuth start,
 * session events). Only the project URL and publishable key reach the bundle.
 * Domain data is read and written exclusively through Next.js server code and
 * Prisma, so the full client (`from`, `rpc`, `storage`) is intentionally not
 * exported. The Data API roles cannot reach application tables either; see
 * `infrastructure/database-access-boundary.ts`.
 */
export function createSupabaseBrowserAuthClient(): SupabaseBrowserAuthClient {
  const environment = getSupabasePublicEnvironment();
  return createBrowserClient(environment.url, environment.publishableKey).auth;
}
