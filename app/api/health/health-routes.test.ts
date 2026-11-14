import { describe, expect, it } from "vitest";

import { GET as live } from "./live/route";
import { createReadyHandler } from "./ready/route";

const requestId = "018f47ca-4f65-7c68-8a50-0ab7cc525a11";
const request = () =>
  new Request("https://notify.example.com/api/health/ready", {
    headers: { "x-request-id": requestId },
  });

describe("health routes", () => {
  it("returns a minimal liveness response", async () => {
    const response = await live(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("returns ready only after database and migration checks pass", async () => {
    const response = await createReadyHandler(async () => ({ ready: true }))(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it("returns a generic 503 without exposing database errors", async () => {
    const databaseError = "password authentication failed for postgres://admin:secret@db/app";
    const response = await createReadyHandler(async () => {
      throw new Error(databaseError);
    })(request());
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(body).toContain(requestId);
    expect(body).not.toContain(databaseError);
    expect(body).not.toContain("admin:secret");
  });
});
