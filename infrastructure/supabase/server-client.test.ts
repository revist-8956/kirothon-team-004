// @vitest-environment node
import type { CookieOptions } from "@supabase/ssr";
import { describe, expect, it } from "vitest";

import {
  createSupabaseAuthApiStub,
  decodeSessionCookieValue,
  expiredSessionCookieValue,
  TEST_SUPABASE_AUTH_COOKIE,
  testSupabaseEnvironment,
} from "@/tests/support/supabase-session";

import { createSupabaseServerClientForCookies, type SupabaseServerContext } from "./server-client";

function createCookieStore(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  const writes: Array<{ name: string; value: string; options: CookieOptions }> = [];
  return {
    writes,
    getAll: () => [...values].map(([name, value]) => ({ name, value })),
    set(name: string, value: string, options: CookieOptions) {
      writes.push({ name, value, options });
      values.set(name, value);
    },
  };
}

async function refreshWith(context: SupabaseServerContext) {
  const store = createCookieStore({ [TEST_SUPABASE_AUTH_COOKIE]: expiredSessionCookieValue() });
  const authApi = createSupabaseAuthApiStub("refresh-token-new");
  const client = createSupabaseServerClientForCookies(store, context, {
    environment: testSupabaseEnvironment,
    fetch: authApi.fetch,
  });

  const { data, error } = await client.auth.getClaims();
  return { store, authApi, claims: data?.claims, error };
}

describe("createSupabaseServerClientForCookies", () => {
  it.each(["server-action", "route-handler"] as const)(
    "persists a refreshed session cookie from a %s",
    async (context) => {
      const { store, authApi, claims, error } = await refreshWith(context);

      expect(error).toBeNull();
      expect(claims?.sub).toBe("00000000-0000-4000-8000-000000000001");
      expect(authApi.requests).toContain("/auth/v1/token?grant_type=refresh_token");

      const sessionWrite = store.writes.find((write) => write.name === TEST_SUPABASE_AUTH_COOKIE);
      expect(sessionWrite).toBeDefined();
      expect(decodeSessionCookieValue(sessionWrite!.value).refresh_token).toBe("refresh-token-new");
      expect(sessionWrite!.options).toMatchObject({ path: "/", sameSite: "lax" });
    },
  );

  it("never writes cookies while rendering a Server Component", async () => {
    const { store, claims, error } = await refreshWith("server-component");

    expect(error).toBeNull();
    expect(claims?.sub).toBe("00000000-0000-4000-8000-000000000001");
    expect(store.writes).toEqual([]);
  });

  it("returns no claims and makes no Auth API call without a session cookie", async () => {
    const store = createCookieStore({});
    const authApi = createSupabaseAuthApiStub();
    const client = createSupabaseServerClientForCookies(store, "server-action", {
      environment: testSupabaseEnvironment,
      fetch: authApi.fetch,
    });

    const { data } = await client.auth.getClaims();

    expect(data).toBeNull();
    expect(authApi.requests).toEqual([]);
    expect(store.writes).toEqual([]);
  });
});
