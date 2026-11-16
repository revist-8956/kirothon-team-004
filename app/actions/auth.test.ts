// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeSessionCookieValue,
  createSupabaseAuthApiStub,
  createTestCookieStore,
  TEST_SUPABASE_AUTH_COOKIE,
  testSupabaseEnvironment,
} from "@/tests/support/supabase-session";

const testState = vi.hoisted(() => ({
  requireUser: vi.fn(),
  cookieStore: undefined as unknown,
  authApi: undefined as unknown,
  redirect: vi.fn((destination: string): never => {
    throw new Error(`redirect:${destination}`);
  }),
}));

vi.mock("@/application/authentication", () => ({ requireUser: testState.requireUser }));
vi.mock("@/infrastructure/supabase/server-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/supabase/server-client")>();
  return {
    ...actual,
    createSupabaseServerActionClient: async () =>
      actual.createSupabaseServerClientForCookies(
        testState.cookieStore as ReturnType<typeof createTestCookieStore>,
        "server-action",
        {
          environment: testSupabaseEnvironment,
          fetch: (testState.authApi as ReturnType<typeof createSupabaseAuthApiStub>).fetch,
        },
      ),
  };
});
vi.mock("next/navigation", () => ({ redirect: testState.redirect }));

import { signOutUser } from "./auth";

describe("signOutUser", () => {
  beforeEach(() => {
    testState.requireUser.mockReset();
    testState.redirect.mockClear();
    testState.cookieStore = createTestCookieStore({
      [TEST_SUPABASE_AUTH_COOKIE]: activeSessionCookieValue(),
    });
    testState.authApi = createSupabaseAuthApiStub();
  });

  it("ends the Supabase session, clears its cookie, and returns to the Google login page", async () => {
    testState.requireUser.mockResolvedValue({ id: "user-1", nickname: "민수", nicknameRequired: false });
    const cookieStore = testState.cookieStore as ReturnType<typeof createTestCookieStore>;
    const authApi = testState.authApi as ReturnType<typeof createSupabaseAuthApiStub>;

    await expect(signOutUser()).rejects.toThrow("redirect:/login");

    expect(testState.requireUser).toHaveBeenCalledWith("/inbox", { allowNicknameRequired: true });
    expect(cookieStore.values.has(TEST_SUPABASE_AUTH_COOKIE)).toBe(false);
    expect(cookieStore.writes).toContainEqual(
      expect.objectContaining({ name: TEST_SUPABASE_AUTH_COOKIE, value: "", options: expect.objectContaining({ maxAge: 0 }) }),
    );
    expect(authApi.requests).toEqual(["/auth/v1/logout?scope=local"]);
  });

  it("does not touch the session when no authenticated user passes the boundary", async () => {
    testState.requireUser.mockRejectedValue(new Error("redirect:/login?returnTo=%2Finbox"));
    const authApi = testState.authApi as ReturnType<typeof createSupabaseAuthApiStub>;

    await expect(signOutUser()).rejects.toThrow("redirect:/login?returnTo=%2Finbox");
    expect(authApi.requests).toEqual([]);
    expect(testState.redirect).not.toHaveBeenCalled();
  });
});
