import type { CookieOptions } from "@supabase/ssr";

import type { SupabasePublicEnvironment } from "@/infrastructure/supabase/public-environment";

/**
 * Test fixtures that isolate the Supabase Auth HTTP boundary. Real project
 * URLs and keys are never used; the Auth API is served by an in-memory fetch.
 */

export const TEST_SUPABASE_PROJECT_REF = "testprojectref";
export const TEST_SUPABASE_URL = `https://${TEST_SUPABASE_PROJECT_REF}.supabase.co`;
export const TEST_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test-only-key";
export const TEST_SUPABASE_AUTH_COOKIE = `sb-${TEST_SUPABASE_PROJECT_REF}-auth-token`;

export const testSupabaseEnvironment: SupabasePublicEnvironment = {
  url: TEST_SUPABASE_URL,
  publishableKey: TEST_SUPABASE_PUBLISHABLE_KEY,
};

export interface TestSupabaseUser {
  id: string;
  aud: string;
  role: string;
  email?: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  created_at: string;
}

export const TEST_USER: TestSupabaseUser = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "google" },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00.000Z",
};

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function unsignedJwt(payload: Record<string, unknown>): string {
  return [
    base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64Url(JSON.stringify(payload)),
    base64Url("test-signature"),
  ].join(".");
}

function session(refreshToken: string, expiresAtSeconds: number, user: TestSupabaseUser = TEST_USER) {
  return {
    access_token: unsignedJwt({
      sub: user.id,
      aud: "authenticated",
      role: "authenticated",
      exp: expiresAtSeconds,
      iat: expiresAtSeconds - 3600,
      session_id: "test-session",
    }),
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAtSeconds,
    user,
  };
}

function encodeSessionCookieValue(value: unknown): string {
  return `base64-${base64Url(JSON.stringify(value))}`;
}

/** Cookie value of an access token that expired an hour ago. */
export function expiredSessionCookieValue(refreshToken = "refresh-token-old"): string {
  const expiredAt = Math.floor(Date.now() / 1000) - 3600;
  return encodeSessionCookieValue(session(refreshToken, expiredAt));
}

/** Cookie value of a session whose access token is valid for another hour. */
export function activeSessionCookieValue(user: TestSupabaseUser = TEST_USER): string {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  return encodeSessionCookieValue(session("refresh-token-active", expiresAt, user));
}

export function decodeSessionCookieValue(value: string): { refresh_token?: string } {
  if (!value.startsWith("base64-")) {
    throw new Error("Unexpected Supabase cookie encoding");
  }
  return JSON.parse(Buffer.from(value.slice("base64-".length), "base64url").toString("utf8"));
}

/** Error body as returned by Supabase Auth; the version header makes the client read `code`. */
function authApiError(status: number, code: string, msg: string): Response {
  return Response.json(
    { code, msg },
    { status, headers: { "X-Supabase-Api-Version": "2024-01-01" } },
  );
}

export interface SupabaseAuthApiStubOptions {
  /** User returned by the PKCE exchange and the user endpoint. */
  user?: TestSupabaseUser;
  /** The only authorization code the PKCE grant accepts. */
  validAuthorizationCode?: string;
  /** Makes `GET /auth/v1/user` reject the access token, like a revoked session. */
  rejectUser?: boolean;
  /** Makes `GET /auth/v1/user` answer 503, like an Auth server outage. */
  unavailableUser?: boolean;
}

/**
 * Minimal Supabase Auth API: refresh-token and PKCE grants, the user endpoint
 * and logout. Request bodies are recorded so tests can verify the PKCE
 * verifier that the client sends.
 */
export function createSupabaseAuthApiStub(
  refreshedToken = "refresh-token-new",
  options: SupabaseAuthApiStubOptions = {},
) {
  const user = options.user ?? TEST_USER;
  const requests: string[] = [];
  const bodies: Array<{ path: string; body: Record<string, unknown> }> = [];

  const fetchStub: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const path = `${url.pathname}${url.search}`;
    requests.push(path);
    const body =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    bodies.push({ path, body });

    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
      const refreshedSession = session(refreshedToken, Math.floor(Date.now() / 1000) + 3600, user);
      return Response.json(refreshedSession);
    }

    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "pkce") {
      const accepted =
        options.validAuthorizationCode !== undefined &&
        body.auth_code === options.validAuthorizationCode &&
        typeof body.code_verifier === "string" &&
        body.code_verifier.length > 0;
      if (!accepted) {
        return authApiError(404, "flow_state_not_found", "invalid flow state, no valid flow state found");
      }
      return Response.json(session("refresh-token-issued", Math.floor(Date.now() / 1000) + 3600, user));
    }

    if (url.pathname === "/auth/v1/user") {
      if (options.unavailableUser) {
        return Response.json({ message: "service unavailable" }, { status: 503 });
      }
      if (options.rejectUser) {
        return authApiError(403, "session_not_found", "session not found");
      }
      return Response.json(user);
    }

    if (url.pathname === "/auth/v1/logout") {
      return new Response(null, { status: 204 });
    }

    return Response.json({ message: "not found" }, { status: 404 });
  };

  return { fetch: fetchStub, requests, bodies };
}

export interface TestCookieWrite {
  name: string;
  value: string;
  options: CookieOptions;
}

/**
 * In-memory stand-in for the Next.js request/response cookie store. A write
 * with `maxAge: 0` deletes the cookie, as a browser would.
 */
export function createTestCookieStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const writes: TestCookieWrite[] = [];

  return {
    values,
    writes,
    getAll: () => [...values].map(([name, value]) => ({ name, value })),
    get(name: string) {
      const value = values.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set(name: string, value: string, options: CookieOptions = {}) {
      writes.push({ name, value, options });
      if (options.maxAge === 0 || value === "") {
        values.delete(name);
      } else {
        values.set(name, value);
      }
    },
  };
}

export type TestCookieStore = ReturnType<typeof createTestCookieStore>;
