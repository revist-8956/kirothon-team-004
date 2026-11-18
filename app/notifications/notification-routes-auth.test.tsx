import { describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  requireUser: vi.fn((returnTo: string): never => {
    throw new Error(`login:${returnTo}`);
  }),
}));

vi.mock("@/application/authentication", () => ({ requireUser: testState.requireUser }));
vi.mock("@/app/actions/notifications", () => ({ scheduleNotificationAction: vi.fn() }));
vi.mock("@/infrastructure/prisma-repositories", () => ({ repositories: {} }));

import StatusPage from "./[notificationId]/status/page";
import ComposePage from "./new/page";
import SchedulePage from "./new/schedule/page";

const notificationId = "11111111-1111-4111-8111-111111111111";

describe("notification routes return a signed-out user to the requested page", () => {
  it("keeps the response status link, including the selected round", async () => {
    await expect(
      StatusPage({
        params: Promise.resolve({ notificationId }),
        searchParams: Promise.resolve({ dispatchId: "d-1" }),
      }),
    ).rejects.toThrow(`login:/notifications/${notificationId}/status?dispatchId=d-1`);
  });

  it("keeps the schedule step with its draft", async () => {
    await expect(SchedulePage({ searchParams: Promise.resolve({ draftId: "draft 1" }) })).rejects.toThrow(
      "login:/notifications/new/schedule?draftId=draft%201",
    );
  });

  it("keeps the group compose link with its group", async () => {
    await expect(
      ComposePage({ searchParams: Promise.resolve({ mode: "group", groupId: "g-1" }) }),
    ).rejects.toThrow("login:/notifications/new?mode=group&groupId=g-1");
    await expect(ComposePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "login:/notifications/new?mode=personal",
    );
  });
});
