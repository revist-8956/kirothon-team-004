// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createSupabaseAuthApiStub,
  decodeSessionCookieValue,
  expiredSessionCookieValue,
  TEST_SUPABASE_AUTH_COOKIE,
  TEST_SUPABASE_PUBLISHABLE_KEY,
  TEST_SUPABASE_URL,
} from "@/tests/support/supabase-session";

import { createLogger } from "../logger";
import { refreshSupabaseSession, resetSupabaseProxyStateForTests } from "./proxy-session";

const environmentSource = {
  NODE_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: TEST_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: TEST_SUPABASE_PUBLISHABLE_KEY,
};

function requestWithCookie(cookie?: string): NextRequest {
  return new NextRequest("https://notify.example.com/inbox", {
    headers: cookie ? { cookie } : {},
  });
}

function captureLogs() {
  const lines: string[] = [];
  return { lines, logger: createLogger({ minimumLevel: "debug", writer: (line) => lines.push(line) }) };
}

describe("refreshSupabaseSession", () => {
  beforeEach(() => {
    resetSupabaseProxyStateForTests();
  });

  it("passes anonymous requests through without calling the Auth API", async () => {
    const authApi = createSupabaseAuthApiStub();

    const response = await refreshSupabaseSession(requestWithCookie(), {
      environmentSource,
      fetch: authApi.fetch,
    });

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.cookies.getAll()).toEqual([]);
    expect(authApi.requests).toEqual([]);
  });

  it("refreshes an expired session onto both the forwarded request and the response", async () => {
    const authApi = createSupabaseAuthApiStub("refresh-token-new");

    const response = await refreshSupabaseSession(
      requestWithCookie(`${TEST_SUPABASE_AUTH_COOKIE}=${expiredSessionCookieValue()}`),
      { environmentSource, fetch: authApi.fetch },
    );

    const sessionCookie = response.cookies.get(TEST_SUPABASE_AUTH_COOKIE);
    expect(sessionCookie).toBeDefined();
    expect(decodeSessionCookieValue(sessionCookie!.value).refresh_token).toBe("refresh-token-new");
    expect(sessionCookie).toMatchObject({ path: "/", sameSite: "lax" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    // Downstream Server Components read the refreshed cookie through request header overrides.
    expect(response.headers.get("x-middleware-override-headers")).toContain("cookie");
    const forwardedCookie = response.headers.get("x-middleware-request-cookie") ?? "";
    const forwardedValue = forwardedCookie.slice(`${TEST_SUPABASE_AUTH_COOKIE}=`.length);
    expect(forwardedCookie.startsWith(`${TEST_SUPABASE_AUTH_COOKIE}=`)).toBe(true);
    expect(decodeSessionCookieValue(forwardedValue).refresh_token).toBe("refresh-token-new");
  });

  it("skips refresh when Supabase is not configured and reports only variable names once", async () => {
    const { lines, logger } = captureLogs();
    const cookie = `${TEST_SUPABASE_AUTH_COOKIE}=${expiredSessionCookieValue()}`;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await refreshSupabaseSession(requestWithCookie(cookie), {
        environmentSource: { NODE_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: TEST_SUPABASE_URL },
        logger,
      });
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.cookies.getAll()).toEqual([]);
    }

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: "warn",
      event: "supabase.session.refresh_skipped",
      fields: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
    });
    expect(lines[0]).not.toContain(TEST_SUPABASE_URL);
  });
});
