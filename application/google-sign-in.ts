import type { CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeReturnTo } from "../domain/return-to";
import type { Logger } from "../infrastructure/logger";
import { ApplicationError } from "./action-result";
import type { RepositoryUnitOfWork } from "./repositories";
import { prepareUserProfile } from "./user-profiles";

/** OAuth redirect target registered in the Supabase redirect allow list. */
export const AUTH_CALLBACK_PATH = "/auth/callback";
export const LOGIN_PATH = "/login";
export const PROFILE_SETUP_PATH = "/profile/setup";

/** Short-lived, HttpOnly cookie that carries the sanitized post-login path through OAuth. */
export const RETURN_TO_COOKIE = "app-auth-return-to";
const RETURN_TO_COOKIE_MAX_AGE_SECONDS = 10 * 60;

/** Value of the `error` query parameter that makes `/login` show the generic failure message. */
export const LOGIN_FAILURE_ERROR = "oauth_failed";

export type SupabaseAuth = SupabaseClient["auth"];

/** The subset of the Next.js cookie store used by the sign-in flow. */
export interface ReturnToCookieJar {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: CookieOptions): unknown;
}

type AuthFlowLogger = Pick<Logger, "info" | "warn">;

const ERROR_CATEGORY = /^[a-z0-9_]{1,64}$/i;

/** Reduces provider and Supabase errors to a short code; descriptions are never logged. */
function errorCategory(value: unknown): string {
  const code =
    typeof value === "string"
      ? value
      : value !== null && typeof value === "object" && "code" in value
        ? value.code
        : undefined;
  return typeof code === "string" && ERROR_CATEGORY.test(code) ? code : "unknown";
}

function returnToCookieOptions(appOrigin: string, maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(appOrigin).protocol === "https:",
    // Only the callback needs the value, so other routes never receive it.
    path: AUTH_CALLBACK_PATH,
    maxAge,
  };
}

export function loginFailurePath(returnTo: string): string {
  const safeReturnTo = encodeURIComponent(sanitizeReturnTo(returnTo));
  return `${LOGIN_PATH}?error=${LOGIN_FAILURE_ERROR}&returnTo=${safeReturnTo}`;
}

function profileSetupPath(returnTo: string): string {
  return `${PROFILE_SETUP_PATH}?returnTo=${encodeURIComponent(returnTo)}`;
}

export interface StartGoogleSignInInput {
  readonly auth: SupabaseAuth;
  readonly cookies: ReturnToCookieJar;
  /** Configured deployment origin; the OAuth callback is always on this origin. */
  readonly appOrigin: string;
  readonly returnTo: string | null | undefined;
  readonly logger: AuthFlowLogger;
}

/**
 * Starts the Supabase Google OAuth (PKCE) flow. The Supabase server client
 * stores the PKCE code verifier in its own cookie, and the sanitized return
 * path is kept in an HttpOnly cookie scoped to the callback.
 *
 * @returns the Supabase authorize URL, or the login failure path.
 */
export async function startGoogleSignIn(input: StartGoogleSignInInput): Promise<string> {
  const returnTo = sanitizeReturnTo(input.returnTo);
  const { data, error } = await input.auth.signInWithOAuth({
    provider: "google",
    // `skipBrowserRedirect` is intentionally not set: on the server it would add
    // `skip_http_redirect=true` and make `/authorize` answer with JSON.
    options: { redirectTo: new URL(AUTH_CALLBACK_PATH, input.appOrigin).toString() },
  });

  if (error || !data.url) {
    input.logger.warn("auth.login.start_failed", { reason: errorCategory(error) });
    return loginFailurePath(returnTo);
  }

  input.cookies.set(
    RETURN_TO_COOKIE,
    returnTo,
    returnToCookieOptions(input.appOrigin, RETURN_TO_COOKIE_MAX_AGE_SECONDS),
  );
  return data.url;
}

export interface CompleteGoogleSignInInput {
  readonly auth: SupabaseAuth;
  readonly cookies: ReturnToCookieJar;
  readonly appOrigin: string;
  /** The callback request URL; only `code`, `error` and `error_code` are read. */
  readonly callbackUrl: URL;
  readonly repositories: RepositoryUnitOfWork;
  readonly logger: AuthFlowLogger;
}

/**
 * Handles the OAuth callback. The authorization code is exchanged for a
 * Supabase cookie session first; only after that succeeds is the application
 * profile prepared. Cancellation and every failure lead to the generic login
 * failure path without creating application data.
 *
 * @returns an internal path to redirect to.
 */
export async function completeGoogleSignIn(input: CompleteGoogleSignInInput): Promise<string> {
  const returnTo = sanitizeReturnTo(input.cookies.get(RETURN_TO_COOKIE)?.value);
  input.cookies.set(RETURN_TO_COOKIE, "", returnToCookieOptions(input.appOrigin, 0));
  const failurePath = loginFailurePath(returnTo);

  const parameters = input.callbackUrl.searchParams;
  const providerError = parameters.get("error_code") ?? parameters.get("error");
  if (providerError !== null) {
    // `access_denied` is the Google cancel case.
    input.logger.warn("auth.login.failed", {
      stage: "provider",
      reason: errorCategory(providerError),
    });
    return failurePath;
  }

  const code = parameters.get("code");
  if (!code) {
    input.logger.warn("auth.login.failed", { stage: "callback", reason: "missing_code" });
    return failurePath;
  }

  const { data, error } = await input.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    input.logger.warn("auth.login.failed", { stage: "exchange", reason: errorCategory(error) });
    return failurePath;
  }

  let nicknameRequired: boolean;
  try {
    const profile = await prepareUserProfile(input.repositories, {
      id: data.user.id,
      email: data.user.email,
      userMetadata: data.user.user_metadata,
    });
    nicknameRequired = profile.nicknameRequired;
  } catch (profileError) {
    // Do not leave a signed-in session that has no usable application profile.
    await endSupabaseSession(input.auth, input.logger, { reason: "profile_unavailable" });
    input.logger.warn("auth.login.failed", {
      stage: "profile",
      reason: profileError instanceof ApplicationError ? profileError.code : "unexpected",
    });
    return failurePath;
  }

  input.logger.info("auth.login.succeeded");
  return nicknameRequired ? profileSetupPath(returnTo) : returnTo;
}

/**
 * Ends the current Supabase session. The `local` scope removes the session
 * cookies before revoking the refresh token on the Auth server, so the device
 * is signed out even when the revocation request fails.
 */
export async function endSupabaseSession(
  auth: SupabaseAuth,
  logger: AuthFlowLogger,
  fields: Readonly<Record<string, string>> = {},
): Promise<void> {
  const { error } = await auth.signOut({ scope: "local" });
  if (error) {
    logger.warn("auth.logout.revoke_failed", { ...fields, reason: errorCategory(error) });
  }
  logger.info("auth.logout", fields);
}
