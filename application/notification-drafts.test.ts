import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ApplicationError } from "./action-result";
import {
  createNotificationDraft,
  getComposeOptions,
} from "./notification-drafts";
import type {
  MembershipRecord,
  CreateDraftInput,
  NotificationDraftRecord,
  RepositoryTransaction,
  RepositoryUnitOfWork,
} from "./repositories";

const clock = new Date("2026-03-01T01:02:03.000Z");

function createRepositoryFixture() {
  const actorId = randomUUID();
  const friendId = randomUUID();
  const groupId = randomUUID();
  const otherGroupId = randomUUID();
  const drafts: NotificationDraftRecord[] = [];
  const locks: string[] = [];
  const memberships = new Set<string>([groupId]);

  const repositories: RepositoryUnitOfWork = {
    transaction: async <T>(work: (transaction: RepositoryTransaction) => Promise<T>) =>
      work({
        now: async () => clock,
        lockGroup: async (id: string) => {
          locks.push(id);
        },
        friends: {
          listFriendIds: async () => [friendId],
          listComposeOptions: async () => [
            { id: friendId, nickname: "친구", email: "friend@example.test" },
          ],
        },
        groups: {
          listCurrentForUser: async () => [
            { id: groupId, name: "현재 그룹", memberCount: 2, latestDispatchSentAt: null },
          ],
        },
        memberships: {
          findCurrent: async (id: string, userId: string) => {
            if (userId !== actorId || !memberships.has(id)) return null;
            return {
              id: randomUUID(),
              groupId: id,
              userId,
              joinedAt: clock,
              leftAt: null,
              emailVisibility: "PRIVATE",
              createdAt: clock,
            } satisfies MembershipRecord;
          },
        },
        drafts: {
          create: async (input: CreateDraftInput) => {
            const draft: NotificationDraftRecord = {
              id: randomUUID(),
              ownerId: input.ownerId,
              sentence: input.sentence,
              mode: input.mode,
              targetJson: input.targetJson as unknown as NotificationDraftRecord["targetJson"],
              expiresAt: input.expiresAt,
              consumedAt: null,
              createdAt: clock,
            };
            drafts.push(draft);
            return draft;
          },
        },
      } as unknown as RepositoryTransaction),
  };

  return { repositories, actorId, friendId, groupId, otherGroupId, drafts, locks, memberships };
}

describe("notification compose options and drafts", () => {
  it("returns only the requested current friend or group options", async () => {
    const { repositories, actorId, friendId, groupId } = createRepositoryFixture();

    await expect(getComposeOptions(repositories, actorId, "PERSONAL")).resolves.toEqual({
      mode: "PERSONAL",
      recipients: [{ id: friendId, nickname: "친구", email: "friend@example.test" }],
    });
    await expect(getComposeOptions(repositories, actorId, "GROUP")).resolves.toEqual({
      mode: "GROUP",
      groups: [{ id: groupId, name: "현재 그룹", memberCount: 2, latestDispatchSentAt: null }],
    });
  });

  it("stores a trimmed personal sentence with only authorized target IDs for thirty minutes", async () => {
    const { repositories, actorId, friendId, drafts } = createRepositoryFixture();

    const draft = await createNotificationDraft(repositories, actorId, {
      sentence: "  회의를 확인해 주세요  ",
      mode: "PERSONAL",
      recipientIds: [friendId],
    });

    expect(draft).toMatchObject({
      ownerId: actorId,
      sentence: "회의를 확인해 주세요",
      mode: "PERSONAL",
      targetJson: { recipientIds: [friendId] },
      expiresAt: new Date(clock.getTime() + 30 * 60 * 1000),
    });
    expect(drafts).toEqual([draft]);
  });

  it("authorizes the selected group under its lock and stores only its ID", async () => {
    const { repositories, actorId, groupId, locks } = createRepositoryFixture();

    const draft = await createNotificationDraft(repositories, actorId, {
      sentence: "점검을 진행해 주세요",
      mode: "GROUP",
      groupId,
    });

    expect(locks).toEqual([groupId]);
    expect(draft).toMatchObject({
      ownerId: actorId,
      mode: "GROUP",
      targetJson: { groupId },
    });
  });

  it("rejects blank, duplicate, non-friend, and non-member targets without storing a draft", async () => {
    const { repositories, actorId, friendId, otherGroupId, drafts } = createRepositoryFixture();

    await expect(
      createNotificationDraft(repositories, actorId, {
        sentence: "   ",
        mode: "PERSONAL",
        recipientIds: [friendId],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" } satisfies Partial<ApplicationError>);
    await expect(
      createNotificationDraft(repositories, actorId, {
        sentence: "점검",
        mode: "PERSONAL",
        recipientIds: [friendId, friendId],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" } satisfies Partial<ApplicationError>);
    await expect(
      createNotificationDraft(repositories, actorId, {
        sentence: "점검",
        mode: "PERSONAL",
        recipientIds: [randomUUID()],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<ApplicationError>);
    await expect(
      createNotificationDraft(repositories, actorId, {
        sentence: "점검",
        mode: "GROUP",
        groupId: otherGroupId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<ApplicationError>);
    expect(drafts).toEqual([]);
  });
});
