import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DEFAULT_RETURN_TO, sanitizeReturnTo } from "./return-to";

const VALIDATION_ORIGIN = "https://return-to.invalid";

function isAllowedInternalPath(value: string): boolean {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("#")
  ) {
    return false;
  }

  try {
    const parsed = new URL(value, VALIDATION_ORIGIN);

    return (
      parsed.origin === VALIDATION_ORIGIN &&
      parsed.hash === "" &&
      value === `${parsed.pathname}${parsed.search}`
    );
  } catch {
    return false;
  }
}

describe("sanitizeReturnTo", () => {
  it("keeps an internal absolute path and its query string", () => {
    expect(sanitizeReturnTo("/invite/token?source=login&step=confirm")).toBe(
      "/invite/token?source=login&step=confirm",
    );
  });

  it.each([
    "https://example.com/invite/token",
    "https://return-to.invalid/invite/token",
    "//example.com/invite/token",
    "/\\example.com/invite/token",
  ])("replaces external or network-path input %j", (candidate) => {
    expect(sanitizeReturnTo(candidate)).toBe(DEFAULT_RETURN_TO);
  });

  it.each([
    "/invite/token\n?step=confirm",
    "/invite/token%0A?step=confirm",
    "/invite/%00token",
  ])("replaces literal or encoded control characters in %j", (candidate) => {
    expect(sanitizeReturnTo(candidate)).toBe(DEFAULT_RETURN_TO);
  });

  it.each(["/invite/%", "/invite/%ZZ", "/invite/%E0%A4%A"])(
    "replaces malformed encoding in %j",
    (candidate) => {
      expect(sanitizeReturnTo(candidate)).toBe(DEFAULT_RETURN_TO);
    },
  );

  it.each([undefined, null, "", "invite/token", "?next=/invite", "/inbox#top"])(
    "replaces input that is not a path-and-query value: %j",
    (candidate) => {
      expect(sanitizeReturnTo(candidate)).toBe(DEFAULT_RETURN_TO);
    },
  );

  it("rejects an encoded scheme-relative path without rejecting encoded query values", () => {
    expect(sanitizeReturnTo("/%2Fexample.com/invite")).toBe(DEFAULT_RETURN_TO);
    expect(sanitizeReturnTo("/login?returnTo=%2F%2Fexample.com")).toBe(
      "/login?returnTo=%2F%2Fexample.com",
    );
  });

  // Feature: personal-group-notifications, Property 2: 로그인 복귀 경로의 동일 출처 보장
  // Validates: Requirements 1.7
  it("returns only an allowed internal path or the inbox for arbitrary URL strings", () => {
    const arbitraryUrlString = fc.oneof(
      fc.string(),
      fc.webUrl(),
      fc.string().map((path) => `/${path}`),
    );

    fc.assert(
      fc.property(arbitraryUrlString, (candidate) => {
        const result = sanitizeReturnTo(candidate);

        expect(result === DEFAULT_RETURN_TO || isAllowedInternalPath(result)).toBe(
          true,
        );
        expect(new URL(result, VALIDATION_ORIGIN).origin).toBe(
          VALIDATION_ORIGIN,
        );
      }),
      { numRuns: 100 },
    );
  });
});
