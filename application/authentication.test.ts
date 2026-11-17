// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeSessionCookieValue,
  createSupabaseAuthApiStub,
  createTestCookieStore,
  TEST_SUPABASE_AUTH_COOKIE,
  TEST_USER,
  testSupabaseEnvironment,
  type SupabaseAuthApiStubOptions,
} from "@/tests/support/supabase-session";

const testState = vi.hoisted(() => ({
  cookieStore: undefined as unknown,
  authApi: undefined as unknown,
  findUnique: vi.fn(),
  loggerWarn: vi.fn(),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`redirect:${destination}`);
  }),
}));

vi.mock("@/infrastructure/supabase/server-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/supabase/server-client")>();
  return {
    ...actual,
    // A real Supabase server client over test cookies; only the Auth HTTP API is stubbed.
    createSupabaseServerComponentClient: async () =>
      actual.createSupabaseServerClientForCookies(
        testState.cookieStore as ReturnType<typeof createTestCookieStore>,
        "server-component",
        {
          environment: testSupabaseEnvironment,
          fetch: (testState.authApi as ReturnType<typeof createSupabaseAuthApiStub>).fetch,
        },
      ),
  };
});
vi.mock("@/infrastructure/db", () => ({
  prisma: { user: { findUnique: testState.findUnique } },
}));
vi.mock("next/navigation", () => ({ redirect: testState.redirect }));

vi.mock("@/infrastructure/logger", () => ({
  logger: { warn: testState.loggerWarn, error: vi.fn(), info: vi.fn() },
}));

import { getOptionalUser, requireUser } from "./authentication";

const profileIncompleteUser = {
  id: TEST_USER.id,
  nickname: "",
  nicknameRequired: true,
};

const readyUser = {
  id: TEST_USER.id,
  nickname: "민수",
  nicknameRequired: false,
};

function useSession(signedIn: boolean, apiOptions: SupabaseAuthApiStubOptions = {}) {
  testState.cookieStore = createTestCookieStore(
    signedIn ? { [TEST_SUPABASE_AUTH_COOKIE]: activeSessionCookieValue() } : {},
  );
  const authApi = createSupabaseAuthApiStub("refresh-token-new", apiOptions);
  testState.authApi = authApi;
  return authApi;
}

function expectRedirect(work: () => Promise<unknown>, destination: string): Promise<void> {
  return work().then(
    () => {
      throw new Error("Expected route redirect");
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(`redirect:${destination}`);
    },
  );
}

describe("application authentication boundary", () => {
  beforeEach(() => {
    testState.findUnique.mockReset();
    testState.redirect.mockClear();
  });

  it("does not load user data without a Supabase session cookie", async () => {
    const authApi = useSession(false);

    await expect(getOptionalUser()).resolves.toBeNull();
    expect(authApi.requests).toEqual([]);
    expect(testState.findUnique).not.toHaveBeenCalled();
  });

  it("verifies the session with the Supabase Auth server and loads that user's profile", async () => {
    const authApi = useSession(true);
    testState.findUnique.mockResolvedValue(readyUser);

    await expect(getOptionalUser()).resolves.toEqual(readyUser);
    expect(authApi.requests).toEqual(["/auth/v1/user"]);
    expect(testState.findUnique).toHaveBeenCalledWith({
      where: { id: TEST_USER.id },
      select: { id: true, nickname: true, nicknameRequired: true },
    });
  });

  it("treats a cookie session that the Auth server rejects as signed out", async () => {
    useSession(true, { rejectUser: true });

    await expect(getOptionalUser()).resolves.toBeNull();
    expect(testState.findUnique).not.toHaveBeenCalled();
  });

  it("fails closed without a login redirect or data access when the Auth server is unavailable", async () => {
    useSession(true, { unavailableUser: true });

    await expect(requireUser("/groups")).rejects.toMatchObject({
      name: "ApplicationError",
      code: "INTERNAL_ERROR",
    });
    expect(testState.redirect).not.toHaveBeenCalled();
    expect(testState.findUnique).not.toHaveBeenCalled();
    expect(testState.loggerWarn).toHaveBeenCalledWith("auth.session.verify_unavailable", {
      status: 503,
    });
    expect(JSON.stringify(testState.loggerWarn.mock.calls)).not.toContain("refresh-token");
  });

  it("does not expose application data for a session whose profile no longer exists", async () => {
    useSession(true);
    testState.findUnique.mockResolvedValue(null);

    await expect(getOptionalUser()).resolves.toBeNull();
    await expectRedirect(() => requireUser("/groups"), "/login?returnTo=%2Fgroups");
  });

  it("redirects unauthenticated protected requests to login with the original safe path", async () => {
    useSession(false);

    await expectRedirect(() => requireUser("/invite/valid-token?source=shared"), "/login?returnTo=%2Finvite%2Fvalid-token%3Fsource%3Dshared");
    await expectRedirect(() => requireUser("//evil.example/inbox"), "/login?returnTo=%2Finbox");
  });

  it("blocks incomplete profiles from protected data while allowing profile setup", async () => {
    useSession(true);
    testState.findUnique.mockResolvedValue(profileIncompleteUser);

    await expectRedirect(() => requireUser("/groups"), "/profile/setup?returnTo=%2Fgroups");
    await expect(requireUser("/profile/setup", { allowNicknameRequired: true })).resolves.toEqual(
      profileIncompleteUser,
    );
  });

  it("returns the application user only after session and nickname checks succeed", async () => {
    useSession(true);
    testState.findUnique.mockResolvedValue(readyUser);

    await expect(requireUser("/inbox")).resolves.toEqual(readyUser);
  });
});
