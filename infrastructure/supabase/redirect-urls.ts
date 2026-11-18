import { AUTH_CALLBACK_PATH } from "../../application/google-sign-in";

/**
 * Origins that may receive the Supabase OAuth redirect (Task 14.7).
 * `APP_BASE_URL` of each environment must be one of these. Keep this list,
 * the Supabase dashboard and `docs/deployment.md` in sync; a test checks
 * that the document lists every URL derived here.
 */
export const APP_ORIGINS = {
  development: "http://localhost:3000",
  production: "https://d277aj369o96rd.cloudfront.net",
} as const;

/** Supabase → Authentication → URL Configuration → Redirect URLs. */
export function supabaseRedirectAllowList(): string[] {
  return Object.values(APP_ORIGINS).map((origin) => new URL(AUTH_CALLBACK_PATH, origin).toString());
}

/**
 * Google Cloud Console → OAuth client → Authorized redirect URIs. Google
 * redirects to Supabase Auth, never directly to this app.
 */
export function googleAuthorizedRedirectUri(supabaseProjectUrl: string): string {
  return new URL("/auth/v1/callback", supabaseProjectUrl).toString();
}
