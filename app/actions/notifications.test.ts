// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actorId = randomUUID();
const friendId = randomUUID();
const groupId = randomUUID();

const testState = vi.hoisted(() => ({
  drafts: [] as Array<{ mode: string; targetJson: unknown }>,
}));

vi.mock("@/application/authentication", () => ({
  requireUser: async () => ({ id: actorId, nickname: "엄마", nicknameRequired: false }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/infrastructure/prisma-repositories", () => ({
  repositories: {
    transaction: async <T,>(work: (transaction: unknown) => Promise<T>) =>
      work({
        now: async () => new Date("2026-03-01T00:00:00.000Z"),
        lockGroup: async () => {},
        friends: { listFriendIds: async () => [friendId] },
        memberships: {
          findCurrent: async (id: string) => (id === groupId ? { id: randomUUID(), groupId, userId: actorId } : null),
        },
        drafts: {
          create: async (input: { mode: string; targetJson: unknown }) => {
            testState.drafts.push(input);
            return { id: randomUUID(), ...input };
          },
        },
      }),
  },
}));

import { createNotificationDraftAction } from "./notifications";

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [name, value] of entries) {
    data.append(name, value);
  }
  return data;
}

describe("createNotificationDraftAction with real form submissions", () => {
  beforeEach(() => {
    testState.drafts.length = 0;
  });

  it("accepts a personal form, which has no groupId field", async () => {
    const result = await createNotificationDraftAction(
      null,
      form([["mode", "PERSONAL"], ["sentence", "저녁 약 챙겨 먹기"], ["recipientIds", friendId]]),
    );

    expect(result).toMatchObject({ ok: true });
    expect(testState.drafts).toEqual([
      expect.objectContaining({ mode: "PERSONAL", targetJson: { recipientIds: [friendId] } }),
    ]);
  });

  it("accepts a group form, which has no recipientIds field", async () => {
    const result = await createNotificationDraftAction(
      null,
      form([["mode", "GROUP"], ["sentence", "저녁 약 챙겨 먹기"], ["groupId", groupId]]),
    );

    expect(result).toMatchObject({ ok: true });
    expect(testState.drafts).toEqual([expect.objectContaining({ mode: "GROUP", targetJson: { groupId } })]);
  });

  it("asks for a recipient when a personal form selects nobody", async () => {
    const result = await createNotificationDraftAction(null, form([["mode", "PERSONAL"], ["sentence", "약 먹기"]]));

    expect(result).toMatchObject({ ok: false, fieldErrors: { recipientIds: ["수신 대상을 한 명 이상 선택해 주세요."] } });
  });

  it("asks for a group when a group form selects none", async () => {
    const result = await createNotificationDraftAction(null, form([["mode", "GROUP"], ["sentence", "약 먹기"]]));

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR", fieldErrors: { groupId: expect.any(Array) } });
  });

  it("rejects personal recipients and a group together with a specific message", async () => {
    const result = await createNotificationDraftAction(
      null,
      form([["mode", "PERSONAL"], ["sentence", "약 먹기"], ["recipientIds", friendId], ["groupId", groupId]]),
    );

    expect(result).toMatchObject({ ok: false, message: "개인 수신자와 그룹을 함께 지정할 수 없어요." });
    expect(testState.drafts).toEqual([]);
  });
});
