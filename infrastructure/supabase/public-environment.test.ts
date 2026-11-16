import { describe, expect, it } from "vitest";

import { EnvironmentConfigurationError } from "../environment-error";
import { isServerOnlySupabaseKey, parseSupabasePublicEnvironment } from "./public-environment";

const base = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://testprojectref.supabase.co/",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-only-key",
};

function jwtWithRole(role: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, iss: "supabase" })}.c2ln`;
}

function issuePaths(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof EnvironmentConfigurationError) {
      return error.issues.map((issue) => issue.path);
    }
    throw error;
  }
  return [];
}

describe("parseSupabasePublicEnvironment", () => {
  it("exposes only the project origin and the publishable key", () => {
    expect(parseSupabasePublicEnvironment(base)).toEqual({
      url: "https://testprojectref.supabase.co",
      publishableKey: "sb_publishable_test-only-key",
    });
  });

  it("falls back to the legacy anon key when no publishable key is set", () => {
    const anonKey = jwtWithRole("anon");
    expect(
      parseSupabasePublicEnvironment({
        ...base,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      }).publishableKey,
    ).toBe(anonKey);
  });

  it("requires a key", () => {
    expect(
      issuePaths(() =>
        parseSupabasePublicEnvironment({ ...base, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined }),
      ),
    ).toEqual(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
  });

  it("allows plain HTTP only for a local Supabase stack outside production", () => {
    expect(
      parseSupabasePublicEnvironment({
        ...base,
        NODE_ENV: "development",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }).url,
    ).toBe("http://127.0.0.1:54321");

    expect(
      issuePaths(() =>
        parseSupabasePublicEnvironment({ ...base, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }),
      ),
    ).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    expect(
      issuePaths(() =>
        parseSupabasePublicEnvironment({
          ...base,
          NODE_ENV: "development",
          NEXT_PUBLIC_SUPABASE_URL: "http://testprojectref.supabase.co",
        }),
      ),
    ).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("rejects URLs carrying credentials or a path", () => {
    expect(
      issuePaths(() =>
        parseSupabasePublicEnvironment({
          ...base,
          NEXT_PUBLIC_SUPABASE_URL: "https://user:pass@testprojectref.supabase.co/rest/v1",
        }),
      ),
    ).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("rejects secret and service role keys without echoing them", () => {
    const secretKey = "sb_secret_never-ship-this-value";
    const serviceRoleKey = jwtWithRole("service_role");

    for (const [field, value] of [
      ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", secretKey],
      ["NEXT_PUBLIC_SUPABASE_ANON_KEY", serviceRoleKey],
    ] as const) {
      let thrown: unknown;
      try {
        parseSupabasePublicEnvironment({ ...base, [field]: value });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(EnvironmentConfigurationError);
      const serialized = JSON.stringify((thrown as EnvironmentConfigurationError).issues);
      expect(serialized).toContain(field);
      expect(serialized).not.toContain(value);
      expect(String(thrown)).not.toContain(value);
    }
  });
});

describe("isServerOnlySupabaseKey", () => {
  it("distinguishes server-only keys from browser-safe keys", () => {
    expect(isServerOnlySupabaseKey("sb_secret_abc")).toBe(true);
    expect(isServerOnlySupabaseKey(jwtWithRole("service_role"))).toBe(true);
    expect(isServerOnlySupabaseKey("sb_publishable_abc")).toBe(false);
    expect(isServerOnlySupabaseKey(jwtWithRole("anon"))).toBe(false);
    expect(isServerOnlySupabaseKey("not.a-valid.jwt")).toBe(false);
  });
});
