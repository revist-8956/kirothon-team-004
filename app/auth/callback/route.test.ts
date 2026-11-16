// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EnsureUserProfileInput,
  RepositoryTransaction,
  RepositoryUnitOfWork,
  UserRecord,
} from "@/application/repositories";
import {
  createSupabaseAuthApiStub,
  createTestCookieStore,
  TEST_SUPABASE_AUTH_COOKIE,
  TEST_USER,
  testSupabaseEnvironment,
} from "@/tests/support/supabase-session";

const VALID_CODE = "valid-authorization-code";

const testState = vi.hoisted(() => ({
  cookieStore: undefined as unknown,
  authApi: undefined as unknown,
  profiles: new Map<string, unknown>(),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`redirect:${destination}`);
  }),
}));

vi.mock("next/headers", () => ({ cookies: async () => testState.cookieStore }));
vi.mock("next/navigation", () => ({ redirect: testState.redirect }));
vi.mock("@/infrastructure/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/infrastructure/supabase/server-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/supabase/server-client")>();
  return {
    ...actual,
    // Real Supabase server client; only the Auth HTTP API is replaced by the stub.
    createSupabaseServerClientForCookies: (
      store: Parameters<typeof actual.createSupabaseServerClientForCookies>[0],
      context: Parameters<typeof actual.createSupabaseServerClientForCookies>[1],
    ) =>
      actual.createSupabaseServerClientForCookies(store, context, {
        environment: testSupabaseEnvironment,
        fetch: (testState.authApi as ReturnType<typeof createSupabaseAuthApiStub>).fetch,
      }),
  };
});
vi.mock("@/infrastructure/prisma-repositories", () => {
  const profiles = testState.profiles as Map<string, UserRecord>;
  const users = {
    findById: async (id: string) => profiles.get(id) ?? null,
    ensureProfile: async (input: EnsureUserProfileInput) => {
      const now = new Date();
      profiles.set(input.id, { ...input, createdAt: now, updatedAt: now });
      return profiles.get(input.id) ?? null;
    },
  };
  const repositories: RepositoryUnitOfWork = {
    transaction: (work) => work({ users } as unknown as RepositoryTransaction),
  };
  return { repositories };
});

import { signInWithGoogle } from "@/app/login/actions";

import { GET } from "./route";

type CookieStore = ReturnType<typeof createTestCookieStore>;

async function startSignIn(returnTo: string): Promise<URL> {
  const formData = new FormData();
  formData.set("returnTo", returnTo);
  const redirect = await signInWithGoogle(formData).then(
    () => {
      throw new Error("Expected a redirect to Supabase");
    },
    (error: unknown) => (error as Error).message,
  );
  return new URL(redirect.replace(/^redirect:/, ""));
}

function callback(query: string): Promise<Response> {
  // The internal request origin differs from the configured public origin, as behind a load balancer.
  return GET(new NextRequest(`http://127.0.0.1:8080/auth/callback${query}`));
}

describe("Google OAuth login and callback routes", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "https://app.example");
    testState.cookieStore = createTestCookieStore();
    testState.authApi = createSupabaseAuthApiStub("refresh-token-new", {
      user: { ...TEST_USER, email: "member@example.com", user_metadata: { full_name: "민수" } },
      validAuthorizationCode: VALID_CODE,
    });
    testState.profiles.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("starts Supabase Google OAuth and returns to the original path on the configured origin", async () => {
    const authorizeUrl = await startSignIn("/groups/group-1?tab=members");
    expect(authorizeUrl.searchParams.get("provider")).toBe("google");
    expect(authorizeUrl.searchParams.get("redirect_to")).toBe("https://app.example/auth/callback");

    const response = await callback(`?code=${VALID_CODE}`);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example/groups/group-1?tab=members");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((testState.cookieStore as CookieStore).values.has(TEST_SUPABASE_AUTH_COOKIE)).toBe(true);
    expect(testState.profiles.has(TEST_USER.id)).toBe(true);
  });

  it("returns a cancelled sign-in to the login failure message without a session or profile", async () => {
    await startSignIn("/groups");

    const response = await callback("?error=access_denied");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.example/login?error=oauth_failed&returnTo=%2Fgroups",
    );
    expect((testState.cookieStore as CookieStore).values.has(TEST_SUPABASE_AUTH_COOKIE)).toBe(false);
    expect(testState.profiles.size).toBe(0);
  });

  it("never redirects off the configured origin for an external return path", async () => {
    await startSignIn("https://evil.example/phish");

    const response = await callback(`?code=${VALID_CODE}`);

    expect(response.headers.get("location")).toBe("https://app.example/inbox");
  });
});
