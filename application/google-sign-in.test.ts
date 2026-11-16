// @vitest-environment node
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createSupabaseServerClientForCookies } from "@/infrastructure/supabase/server-client";
import {
  activeSessionCookieValue,
  createSupabaseAuthApiStub,
  createTestCookieStore,
  TEST_SUPABASE_AUTH_COOKIE,
  TEST_SUPABASE_URL,
  TEST_USER,
  testSupabaseEnvironment,
  type SupabaseAuthApiStubOptions,
  type TestCookieStore,
  type TestSupabaseUser,
} from "@/tests/support/supabase-session";

import {
  completeGoogleSignIn,
  endSupabaseSession,
  RETURN_TO_COOKIE,
  startGoogleSignIn,
} from "./google-sign-in";
import type {
  EnsureUserProfileInput,
  RepositoryTransaction,
  RepositoryUnitOfWork,
  UserRecord,
} from "./repositories";

const APP_ORIGIN = "https://app.example";
const VALID_CODE = "valid-authorization-code";

const googleUser: TestSupabaseUser = {
  ...TEST_USER,
  email: "Member@Example.com",
  user_metadata: { full_name: "  민수  ", name: "민수" },
};

/** In-memory profile store with PostgreSQL's id and normalized-email uniqueness. */
function createProfileStore(initial: readonly UserRecord[] = []) {
  const profiles = new Map(initial.map((profile) => [profile.id, profile]));
  const ensured: EnsureUserProfileInput[] = [];
  const users = {
    findById: async (id: string) => profiles.get(id) ?? null,
    ensureProfile: async (input: EnsureUserProfileInput) => {
      ensured.push(input);
      const emailTaken = [...profiles.values()].some(
        (profile) => profile.emailNormalized === input.emailNormalized && profile.id !== input.id,
      );
      if (!profiles.has(input.id) && !emailTaken) {
        const now = new Date();
        profiles.set(input.id, { ...input, createdAt: now, updatedAt: now });
      }
      return profiles.get(input.id) ?? null;
    },
  };
  const repositories: RepositoryUnitOfWork = {
    transaction: (work) => work({ users } as unknown as RepositoryTransaction),
  };
  return { repositories, profiles, ensured };
}

function storedProfile(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: TEST_USER.id,
    email: "member@example.com",
    emailNormalized: "member@example.com",
    nickname: "직접 정한 닉네임",
    nicknameRequired: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function createLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

function authClient(
  store: TestCookieStore,
  context: "server-action" | "route-handler",
  authApi: ReturnType<typeof createSupabaseAuthApiStub>,
) {
  return createSupabaseServerClientForCookies(store, context, {
    environment: testSupabaseEnvironment,
    fetch: authApi.fetch,
  }).auth;
}

function hasSessionCookie(store: TestCookieStore): boolean {
  return store.values.has(TEST_SUPABASE_AUTH_COOKIE);
}

/** The fixed verifier key that a server-side exchange (no flow id in the callback) reads. */
const CODE_VERIFIER_COOKIE = `${TEST_SUPABASE_AUTH_COOKIE}-code-verifier`;

function hasCodeVerifierCookie(store: TestCookieStore): boolean {
  return store.values.has(CODE_VERIFIER_COOKIE);
}

async function startFlow(returnTo: string | undefined, apiOptions: SupabaseAuthApiStubOptions = {}) {
  const store = createTestCookieStore();
  const authApi = createSupabaseAuthApiStub("refresh-token-new", {
    user: googleUser,
    validAuthorizationCode: VALID_CODE,
    ...apiOptions,
  });
  const logger = createLogger();
  const authorizeUrl = await startGoogleSignIn({
    auth: authClient(store, "server-action", authApi),
    cookies: store,
    appOrigin: APP_ORIGIN,
    returnTo,
    logger,
  });
  return { store, authApi, logger, authorizeUrl };
}

async function finishFlow(
  flow: Awaited<ReturnType<typeof startFlow>>,
  callbackQuery: string,
  profileStore = createProfileStore(),
) {
  const destination = await completeGoogleSignIn({
    auth: authClient(flow.store, "route-handler", flow.authApi),
    cookies: flow.store,
    appOrigin: APP_ORIGIN,
    callbackUrl: new URL(`/auth/callback${callbackQuery}`, APP_ORIGIN),
    repositories: profileStore.repositories,
    logger: flow.logger,
  });
  return { destination, profileStore };
}

describe("startGoogleSignIn", () => {
  it("redirects to the Supabase Google authorize URL with PKCE and the configured callback origin", async () => {
    const { store, authApi, authorizeUrl } = await startFlow("/groups/group-1?tab=members");

    const url = new URL(authorizeUrl);
    expect(url.origin).toBe(TEST_SUPABASE_URL);
    expect(url.pathname).toBe("/auth/v1/authorize");
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toBe(`${APP_ORIGIN}/auth/callback`);
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    // The browser must follow a 302 from /authorize, not receive JSON.
    expect(url.searchParams.has("skip_http_redirect")).toBe(false);

    expect(hasCodeVerifierCookie(store)).toBe(true);
    expect(store.writes.find((write) => write.name === RETURN_TO_COOKIE)).toEqual({
      name: RETURN_TO_COOKIE,
      value: "/groups/group-1?tab=members",
      options: {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/auth/callback",
        maxAge: 600,
      },
    });
    expect(authApi.requests).toEqual([]);
  });

  it.each([
    "https://evil.example/inbox",
    "//evil.example/inbox",
    "/\\evil.example",
    "/%2F%2Fevil.example",
    "/inbox\nSet-Cookie: x=y",
    "javascript:alert(1)",
    undefined,
  ])("stores only the default internal path for the unsafe return path %j", async (returnTo) => {
    const { store } = await startFlow(returnTo);

    expect(store.get(RETURN_TO_COOKIE)?.value).toBe("/inbox");
  });
});

describe("completeGoogleSignIn", () => {
  it("exchanges the PKCE code for a cookie session, then creates the new Google user's profile", async () => {
    const flow = await startFlow("/invite/token-1?source=shared");
    const { destination, profileStore } = await finishFlow(flow, `?code=${VALID_CODE}`);

    expect(destination).toBe("/invite/token-1?source=shared");

    const exchange = flow.authApi.bodies.find((request) => request.path === "/auth/v1/token?grant_type=pkce");
    const verifier = String(exchange?.body.code_verifier);
    const challenge = new URL(flow.authorizeUrl).searchParams.get("code_challenge");
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);

    expect(hasSessionCookie(flow.store)).toBe(true);
    expect(hasCodeVerifierCookie(flow.store)).toBe(false);
    expect(flow.store.get(RETURN_TO_COOKIE)).toBeUndefined();
    expect(profileStore.profiles.get(TEST_USER.id)).toMatchObject({
      email: "Member@Example.com",
      emailNormalized: "member@example.com",
      nickname: "민수",
      nicknameRequired: false,
    });
    expect(flow.logger.info).toHaveBeenCalledWith("auth.login.succeeded");
  });

  it("signs an existing user into the existing profile without overwriting the chosen nickname", async () => {
    const existing = storedProfile();
    const flow = await startFlow("/groups");
    const { destination, profileStore } = await finishFlow(
      flow,
      `?code=${VALID_CODE}`,
      createProfileStore([existing]),
    );

    expect(destination).toBe("/groups");
    expect(profileStore.profiles.get(TEST_USER.id)).toEqual(existing);
    expect(profileStore.ensured).toEqual([]);
  });

  it("sends a user whose Google name is not a valid nickname to profile setup with the return path", async () => {
    const flow = await startFlow("/groups?tab=mine", {
      user: { ...googleUser, user_metadata: { full_name: "가".repeat(21) } },
    });
    const { destination, profileStore } = await finishFlow(flow, `?code=${VALID_CODE}`);

    expect(destination).toBe("/profile/setup?returnTo=%2Fgroups%3Ftab%3Dmine");
    expect(profileStore.profiles.get(TEST_USER.id)?.nicknameRequired).toBe(true);
  });

  it("creates no session or profile when the user cancels Google sign-in", async () => {
    const flow = await startFlow("/groups");
    const { destination, profileStore } = await finishFlow(
      flow,
      "?error=access_denied&error_description=The+user+denied+access+for+member%40example.com",
    );

    expect(destination).toBe("/login?error=oauth_failed&returnTo=%2Fgroups");
    expect(flow.authApi.requests).toEqual([]);
    expect(profileStore.ensured).toEqual([]);
    expect(profileStore.profiles.size).toBe(0);
    expect(hasSessionCookie(flow.store)).toBe(false);
    expect(flow.store.get(RETURN_TO_COOKIE)).toBeUndefined();
    expect(flow.logger.warn).toHaveBeenCalledWith("auth.login.failed", {
      stage: "provider",
      reason: "access_denied",
    });
    expect(JSON.stringify(flow.logger.warn.mock.calls)).not.toContain("example.com");
  });

  it.each([
    ["an authorization code Supabase rejects", "?code=forged-code", "flow_state_not_found"],
    ["a callback without a code", "", "missing_code"],
  ])("creates no session or profile for %s", async (_name, callbackQuery, reason) => {
    const flow = await startFlow("/sent");
    const { destination, profileStore } = await finishFlow(flow, callbackQuery);

    expect(destination).toBe("/login?error=oauth_failed&returnTo=%2Fsent");
    expect(profileStore.ensured).toEqual([]);
    expect(hasSessionCookie(flow.store)).toBe(false);
    expect(flow.logger.warn).toHaveBeenCalledWith(
      "auth.login.failed",
      expect.objectContaining({ reason }),
    );
  });

  it("ends the new session when the application profile cannot be prepared", async () => {
    // Another profile already owns the normalized email.
    const flow = await startFlow("/groups");
    const { destination, profileStore } = await finishFlow(
      flow,
      `?code=${VALID_CODE}`,
      createProfileStore([storedProfile({ id: "00000000-0000-4000-8000-000000000099" })]),
    );

    expect(destination).toBe("/login?error=oauth_failed&returnTo=%2Fgroups");
    expect(profileStore.profiles.has(TEST_USER.id)).toBe(false);
    expect(hasSessionCookie(flow.store)).toBe(false);
    expect(flow.authApi.requests).toContain("/auth/v1/logout?scope=local");
    expect(flow.logger.warn).toHaveBeenCalledWith("auth.login.failed", {
      stage: "profile",
      reason: "CONFLICT",
    });
  });

  it.each(["//evil.example/inbox", "https://evil.example", "/inbox\r\nLocation: https://evil.example"])(
    "re-sanitizes a tampered return path cookie %j to the default page",
    async (tampered) => {
      const flow = await startFlow("/groups");
      flow.store.values.set(RETURN_TO_COOKIE, tampered);
      const { destination } = await finishFlow(flow, `?code=${VALID_CODE}`);

      expect(destination).toBe("/inbox");
    },
  );
});

describe("endSupabaseSession", () => {
  it("clears the session cookie and revokes only the current session on the Auth server", async () => {
    const store = createTestCookieStore({ [TEST_SUPABASE_AUTH_COOKIE]: activeSessionCookieValue() });
    const authApi = createSupabaseAuthApiStub();
    const logger = createLogger();

    await endSupabaseSession(authClient(store, "server-action", authApi), logger);

    expect(hasSessionCookie(store)).toBe(false);
    expect(authApi.requests).toEqual(["/auth/v1/logout?scope=local"]);
    expect(logger.info).toHaveBeenCalledWith("auth.logout", {});
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
