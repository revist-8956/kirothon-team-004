import { randomUUID } from "node:crypto";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { isNonBlankText } from "../domain/content";
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

function createRepositoryFixture(initialFriendIds: readonly string[] = [randomUUID()]) {
  const actorId = randomUUID();
  const friendIds = [...initialFriendIds];
  const friendId = friendIds[0] ?? randomUUID();
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
          listFriendIds: async () => [...friendIds],
          listComposeOptions: async () =>
            friendIds.map((id, index) => ({
              id,
              nickname: `친구 ${index + 1}`,
              email: `friend-${index + 1}@example.test`,
            })),
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

  return {
    repositories,
    actorId,
    friendId,
    friendIds,
    groupId,
    otherGroupId,
    drafts,
    locks,
    memberships,
  };
}

describe("notification compose options and drafts", () => {
  it("returns only the requested current friend or group options", async () => {
    const { repositories, actorId, friendId, groupId } = createRepositoryFixture();

    await expect(getComposeOptions(repositories, actorId, "PERSONAL")).resolves.toEqual({
      mode: "PERSONAL",
      recipients: [{ id: friendId, nickname: "친구 1", email: "friend-1@example.test" }],
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

  it("rejects multiple group targets before locking or storing a draft", async () => {
    const { repositories, actorId, groupId, otherGroupId, drafts, locks } = createRepositoryFixture();

    await expect(
      createNotificationDraft(repositories, actorId, {
        sentence: "점검",
        mode: "GROUP",
        groupId: [groupId, otherGroupId],
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "그룹은 하나만 지정할 수 있어요.",
      fieldErrors: { groupId: ["그룹은 하나만 지정할 수 있어요."] },
    } satisfies Partial<ApplicationError>);

    expect(locks).toEqual([]);
    expect(drafts).toEqual([]);
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

  // Feature: personal-group-notifications, Property 9: 알림 대상의 배타성과 문장 유효성
  // Validates: Requirements 7.3, 7.5, 8.2, 9.2
  it("stores only a non-blank sentence with one target kind matching the selected mode", async () => {
    const whitespaceOnlySentence = fc
      .array(fc.constantFrom(" ", "\t", "\n", "\r", "\u00a0", "\u3000"), {
        minLength: 1,
        maxLength: 20,
      })
      .map((characters) => characters.join(""));
    const sentenceArbitrary = fc.oneof(fc.string(), whitespaceOnlySentence);

    await fc.assert(
      fc.asyncProperty(
        sentenceArbitrary,
        fc.constantFrom("PERSONAL", "GROUP"),
        fc.boolean(),
        fc.integer({ min: 0, max: 2 }),
        async (sentence, mode, hasPersonalTarget, groupTargetCount) => {
          const { repositories, actorId, friendId, groupId, otherGroupId, drafts } =
            createRepositoryFixture();
          const input: Record<string, unknown> = {
            sentence,
            mode,
            ...(hasPersonalTarget ? { recipientIds: [friendId] } : {}),
            ...(groupTargetCount === 1
              ? { groupId }
              : groupTargetCount === 2
                ? { groupId: [groupId, otherGroupId] }
                : {}),
          };
          const hasGroupTarget = groupTargetCount > 0;
          const hasExactlyOneTargetKind = hasPersonalTarget !== hasGroupTarget;
          const targetMatchesMode =
            (mode === "PERSONAL" && hasPersonalTarget) ||
            (mode === "GROUP" && groupTargetCount === 1);
          const canStore = isNonBlankText(sentence) && hasExactlyOneTargetKind && targetMatchesMode;

          if (canStore) {
            const draft = await createNotificationDraft(repositories, actorId, input);

            expect(drafts).toEqual([draft]);
            expect(draft.sentence).toBe(sentence.trim());
            expect(draft.mode).toBe(mode);
            expect(draft.targetJson).toEqual(
              mode === "PERSONAL" ? { recipientIds: [friendId] } : { groupId },
            );
            return;
          }

          await expect(createNotificationDraft(repositories, actorId, input)).rejects.toMatchObject({
            code: "VALIDATION_ERROR",
          } satisfies Partial<ApplicationError>);
          expect(drafts).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});


type PersonalTargetScenario = {
  readonly friendIds: readonly string[];
  readonly recipientIds: readonly string[];
  readonly isAuthorizedSelection: boolean;
};

const personalTargetScenarioArbitrary: fc.Arbitrary<PersonalTargetScenario> = fc
  .uniqueArray(fc.uuid(), { maxLength: 8 })
  .chain((friendIds) => {
    const noRecipients = fc.constant<PersonalTargetScenario>({
      friendIds,
      recipientIds: [],
      isAuthorizedSelection: false,
    });
    const nonFriendRecipients = fc
      .uuid()
      .filter((candidate) => !friendIds.includes(candidate))
      .chain((nonFriendId) =>
        fc.subarray(friendIds).map<PersonalTargetScenario>((friendSubset) => ({
          friendIds,
          recipientIds: [...friendSubset, nonFriendId],
          isAuthorizedSelection: false,
        })),
      );

    if (friendIds.length === 0) {
      return fc.oneof(noRecipients, nonFriendRecipients);
    }

    return fc.oneof(
      noRecipients,
      fc.subarray(friendIds, { minLength: 1 }).map<PersonalTargetScenario>((friendSubset) => ({
        friendIds,
        recipientIds: friendSubset,
        isAuthorizedSelection: true,
      })),
      nonFriendRecipients,
    );
  });

describe("personal target selection and snapshot", () => {
  // Feature: personal-group-notifications, Property 10: 개인 대상 선택과 스냅샷
  // **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
  it("offers exactly the sender's friends, snapshots valid subsets, and stores nothing for invalid input", async () => {
    await fc.assert(
      fc.asyncProperty(personalTargetScenarioArbitrary, async (scenario) => {
        const { repositories, actorId, friendIds, drafts } = createRepositoryFixture(scenario.friendIds);
        const options = await getComposeOptions(repositories, actorId, "PERSONAL");
        if (options.mode !== "PERSONAL") {
          throw new Error("expected personal compose options");
        }

        expect(new Set(options.recipients.map((recipient) => recipient.id))).toEqual(
          new Set(scenario.friendIds),
        );

        const request = {
          sentence: "점검을 확인해 주세요.",
          mode: "PERSONAL" as const,
          recipientIds: scenario.recipientIds,
        };

        if (!scenario.isAuthorizedSelection) {
          await expect(createNotificationDraft(repositories, actorId, request)).rejects.toMatchObject({
            code: scenario.recipientIds.length === 0 ? "VALIDATION_ERROR" : "FORBIDDEN",
          } satisfies Partial<ApplicationError>);
          expect(drafts).toEqual([]);
          return;
        }

        const draft = await createNotificationDraft(repositories, actorId, request);
        expect(drafts).toEqual([draft]);
        expect(draft.targetJson).toEqual({ recipientIds: scenario.recipientIds });

        friendIds.splice(0, friendIds.length);
        expect(draft.targetJson).toEqual({ recipientIds: scenario.recipientIds });
      }),
      { numRuns: 100 },
    );
  });
});


type GroupTargetInputShape = "NONE" | "SINGLE" | "MULTIPLE";

interface GroupTargetPolicyScenario {
  readonly memberships: readonly MembershipRecord[];
  readonly activeGroupIds: readonly string[];
  readonly groupInput: string | readonly string[] | undefined;
}

const GROUP_TARGET_ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const GROUP_TARGET_OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";

function policyGroupId(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function policyMembership(
  id: string,
  groupId: string,
  userId: string,
  active: boolean,
): MembershipRecord {
  return {
    id,
    groupId,
    userId,
    joinedAt: clock,
    leftAt: active ? null : clock,
    emailVisibility: "PRIVATE",
    createdAt: clock,
  };
}

const groupTargetPolicyScenarioArbitrary: fc.Arbitrary<GroupTargetPolicyScenario> = fc
  .tuple(
    fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }),
    fc.constantFrom<GroupTargetInputShape>("NONE", "SINGLE", "MULTIPLE"),
    fc.nat(),
  )
  .map(([actorMembershipStates, inputShape, selectedIndex]) => {
    const groupIds = actorMembershipStates.map((_, index) => policyGroupId(index + 10));
    const actorMemberships = actorMembershipStates.map((active, index) =>
      policyMembership(`10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, groupIds[index]!, GROUP_TARGET_ACTOR_ID, active),
    );
    const unrelatedMemberships = groupIds.map((groupId, index) =>
      policyMembership(`20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, groupId, GROUP_TARGET_OTHER_USER_ID, true),
    );
    const selectedGroupId = groupIds[selectedIndex % groupIds.length]!;
    const alternateGroupId = groupIds[(selectedIndex + 1) % groupIds.length]!;
    const groupInput =
      inputShape === "NONE"
        ? undefined
        : inputShape === "SINGLE"
          ? selectedGroupId
          : [selectedGroupId, alternateGroupId];

    return {
      memberships: [...actorMemberships, ...unrelatedMemberships],
      activeGroupIds: groupIds.filter((_, index) => actorMembershipStates[index]),
      groupInput,
    };
  });

function createGroupTargetPolicyFixture(memberships: readonly MembershipRecord[]) {
  const drafts: NotificationDraftRecord[] = [];
  const locks: string[] = [];
  const transaction = {
    now: async () => clock,
    lockGroup: async (groupId: string) => {
      locks.push(groupId);
    },
    groups: {
      listCurrentForUser: async (userId: string) =>
        memberships
          .filter((membership) => membership.userId === userId && membership.leftAt === null)
          .map((membership) => ({
            id: membership.groupId,
            name: `그룹 ${membership.groupId}`,
            memberCount: 2,
            latestDispatchSentAt: null,
          })),
    },
    memberships: {
      findCurrent: async (groupId: string, userId: string) =>
        memberships.find(
          (membership) =>
            membership.groupId === groupId &&
            membership.userId === userId &&
            membership.leftAt === null,
        ) ?? null,
    },
    drafts: {
      create: async (input: CreateDraftInput) => {
        const draft: NotificationDraftRecord = {
          id: `draft-${drafts.length + 1}`,
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
  } as unknown as RepositoryTransaction;
  const repositories: RepositoryUnitOfWork = {
    transaction: async <T>(work: (current: RepositoryTransaction) => Promise<T>): Promise<T> =>
      work(transaction),
  };

  return { repositories, drafts, locks };
}

describe("Property 11: group target selection and registration authorization", () => {
  // Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5
  it("lists exactly the actor's active groups and accepts one selected current-membership group only", async () => {
    await fc.assert(
      fc.asyncProperty(groupTargetPolicyScenarioArbitrary, async (scenario) => {
        const { repositories, drafts, locks } = createGroupTargetPolicyFixture(scenario.memberships);

        const options = await getComposeOptions(repositories, GROUP_TARGET_ACTOR_ID, "GROUP");
        expect(options).toMatchObject({ mode: "GROUP" });
        if (options.mode !== "GROUP") {
          throw new Error("Group compose options must retain the requested mode.");
        }
        expect(options.groups.map((group) => group.id)).toEqual(scenario.activeGroupIds);

        const input: Record<string, unknown> = {
          sentence: "그룹 공지를 확인해 주세요",
          mode: "GROUP",
        };
        if (scenario.groupInput !== undefined) {
          input.groupId = scenario.groupInput;
        }

        const hasOneGroupTarget = typeof scenario.groupInput === "string";
        const isCurrentMemberOfSelectedGroup =
          hasOneGroupTarget && scenario.activeGroupIds.includes(scenario.groupInput);

        if (isCurrentMemberOfSelectedGroup) {
          const draft = await createNotificationDraft(
            repositories,
            GROUP_TARGET_ACTOR_ID,
            input,
          );
          expect(drafts).toEqual([draft]);
          expect(draft.targetJson).toEqual({ groupId: scenario.groupInput });
          expect(locks).toEqual([scenario.groupInput]);
          return;
        }

        await expect(
          createNotificationDraft(repositories, GROUP_TARGET_ACTOR_ID, input),
        ).rejects.toMatchObject({
          code: hasOneGroupTarget ? "FORBIDDEN" : "VALIDATION_ERROR",
        } satisfies Partial<ApplicationError>);
        expect(drafts).toEqual([]);
        expect(locks).toEqual(hasOneGroupTarget ? [scenario.groupInput] : []);
      }),
      { numRuns: 100 },
    );
  });
});
