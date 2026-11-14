import { describe, expect, it } from "vitest";

import { isTrustedRequestId, requestIdFromHeaders } from "./request-id";

describe("request ID", () => {
  it("keeps a valid inbound UUID", () => {
    const requestId = "018f47ca-4f65-7c68-8a50-0ab7cc525a11";
    expect(requestIdFromHeaders(new Headers({ "x-request-id": requestId }))).toBe(requestId);
  });

  it("replaces untrusted values with a UUID", () => {
    const requestId = requestIdFromHeaders({
      get: () => "line-break forged-log-entry",
    });

    expect(isTrustedRequestId(requestId)).toBe(true);
    expect(requestId).not.toContain("forged-log-entry");
  });
});
