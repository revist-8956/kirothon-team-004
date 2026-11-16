import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ApplicationError } from "./action-result";
import { createNotificationDraft, getComposeOptions } from "./notification-drafts";
import type {
  CreateDraftInput,
  NotificationDraftRecord,
  RepositoryTransaction,
  RepositoryUnitOfWork,
} from "./repositories";

const clock = new Date("2026-03-01T01:02:03.000Z");
const RECIPIENTS_ERROR_MESSAGE = "수신 대상을 한 명 이상 선택해 주세요.";
const NON_FRIEND_RECIPIENT_ERROR_MESSAGE = "친구가 아닌 사용자는 선택할 수 없어요.";

type UserRole = "FRIEND" | "OTHER_USERS_FRIEND" | "STRANGER";

interface PersonalSnapshotScenario {
  readonly actorId: string;
  readonly otherUserId: string;
  readonly friendIds: readonly string[];
  readonly otherUsersFriendIds: readonly string[];
  /** Users who are not the actor's friends, including the actor and the other user. */
  readonly nonFriendIds: readonly string[];
  readonly recipientIds: readonly string[];
  /** Friends removed and users added to the actor's friend list after the draft is stored. */
  readonly removedFriendIds: readonly string[];
  readonly addedFriendIds: readonly string[];
}

const personalSnapshotScenarioArbitrary: fc.Arbitrary<PersonalSnapshotScenario> = fc
  .uniqueArray(fc.uuid(), { minLength: 2, maxLength: 14 })
  .chain(([actorId, otherUserId, ...userIds]) =>
    fc
      .array(fc.constantFrom<UserRole>("FRIEND", "OTHER_USERS_FRIEND", "STRANGER"), {
        minLength: userIds.length,
        maxLength: userIds.length,
      })
      .chain((roles) => {
        const friendIds = userIds.filter((_, index) => roles[index] === "FRIEND");
        const otherUsersFriendIds = userIds.filter(
          (_, index) => roles[index] === "OTHER_USERS_FRIEND",
        );
        const strangerIds = userIds.filter((_, index) => roles[index] === "STRANGER");
        const nonFriendIds = [actorId!, otherUserId!, ...otherUsersFriendIds, ...strangerIds];
        const addableIds = [...otherUsersFriendIds, ...strangerIds];

        return fc
          .record({
            selectedFriends: fc.shuffledSubarray(friendIds),
            selectedNonFriends: fc.oneof(
              { weight: 3, arbitrary: fc.constant<string[]>([]) },
              { weight: 1, arbitrary: fc.subarray(nonFriendIds, { minLength: 1, maxLength: 2 }) },
            ),
            duplicateIndex: fc.option(fc.nat(), { freq: 4 }),
            removedFriendIds: fc.subarray(friendIds),
            addedFriendIds: fc.subarray(addableIds),
          })
          .map(
            ({
              selectedFriends,
              selectedNonFriends,
              duplicateIndex,
              removedFriendIds,
              addedFriendIds,
            }): PersonalSnapshotScenario => {
              const distinctRecipients = [...selectedFriends, ...selectedNonFriends];
              const recipientIds =
                duplicateIndex !== null && distinctRecipients.length > 0
                  ? [
                      ...distinctRecipients,
                      distinctRecipients[duplicateIndex % distinctRecipients.length]!,
                    ]
                  : distinctRecipients;

              return {
                actorId: actorId!,
                otherUserId: otherUserId!,
                friendIds,
                otherUsersFriendIds,
                nonFriendIds,
                recipientIds,
                removedFriendIds,
                addedFriendIds,
              };
            },
          );
      }),
  );

/**
 * In-memory repository scoped by owner. Stored drafts are serialized through
 * JSON at write time, as the database JSON column would do, so later changes
 * to friendships cannot reach the persisted target IDs through shared references.
 */
function createFriendScopedFixture(scenario: PersonalSnapshotScenario) {
  const friendsByOwner = new Map<string, string[]>([
    [scenario.actorId, [...scenario.friendIds]],
    [scenario.otherUserId, [...scenario.otherUsersFriendIds]],
  ]);
  const persistedDrafts: NotificationDraftRecord[] = [];
  let createCalls = 0;

  const transaction = {
    now: async () => clock,
    lockGroup: async () => undefined,
    friends: {
      listFriendIds: async (ownerId: string) => [...(friendsByOwner.get(ownerId) ?? [])],
      listComposeOptions: async (ownerId: string) =>
        (friendsByOwner.get(ownerId) ?? []).map((id, index) => ({
          id,
          nickname: `친구 ${index + 1}`,
          email: `friend-${index + 1}@example.test`,
        })),
    },
    drafts: {
      create: async (input: CreateDraftInput) => {
        createCalls += 1;
        const draft: NotificationDraftRecord = {
          id: `draft-${createCalls}`,
          ownerId: input.ownerId,
          sentence: input.sentence,
          mode: input.mode,
          targetJson: JSON.parse(
            JSON.stringify(input.targetJson),
          ) as NotificationDraftRecord["targetJson"],
          expiresAt: input.expiresAt,
          consumedAt: null,
          createdAt: clock,
        };
        persistedDrafts.push(draft);
        return draft;
      },
    },
  } as unknown as RepositoryTransaction;

  const repositories: RepositoryUnitOfWork = {
    transaction: async <T>(work: (current: RepositoryTransaction) => Promise<T>): Promise<T> =>
      work(transaction),
  };

  function changeActorFriends(removedIds: readonly string[], addedIds: readonly string[]) {
    const removed = new Set(removedIds);
    const current = (friendsByOwner.get(scenario.actorId) ?? []).filter((id) => !removed.has(id));
    friendsByOwner.set(scenario.actorId, [...current, ...addedIds]);
  }

  return {
    repositories,
    persistedDrafts,
    changeActorFriends,
    createCalls: () => createCalls,
  };
}

async function selectableRecipientIds(repositories: RepositoryUnitOfWork, actorId: string) {
  const options = await getComposeOptions(repositories, actorId, "PERSONAL");
  if (options.mode !== "PERSONAL") {
    throw new Error("Personal compose options must retain the requested mode.");
  }
  return new Set(options.recipients.map((recipient) => recipient.id));
}

describe("Property 10: personal target selection and snapshot", () => {
  // Feature: personal-group-notifications, Property 10: 개인 대상 선택과 스냅샷
  // **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
  it("offers only the sender's current friends, stores exactly a valid friend subset, and keeps it fixed after friendship changes", async () => {
    await fc.assert(
      fc.asyncProperty(personalSnapshotScenarioArbitrary, async (scenario) => {
        const fixture = createFriendScopedFixture(scenario);
        const friendSet = new Set(scenario.friendIds);

        // 8.1: the selectable set equals the sender's friend set and nothing else.
        expect(await selectableRecipientIds(fixture.repositories, scenario.actorId)).toEqual(
          friendSet,
        );

        const requestedRecipientIds = [...scenario.recipientIds];
        const request = {
          sentence: "점검 결과를 확인해 주세요.",
          mode: "PERSONAL" as const,
          recipientIds: requestedRecipientIds,
        };
        const isEmpty = scenario.recipientIds.length === 0;
        const hasDuplicate = new Set(scenario.recipientIds).size !== scenario.recipientIds.length;
        const hasNonFriend = scenario.recipientIds.some((id) => !friendSet.has(id));

        if (isEmpty || hasDuplicate || hasNonFriend) {
          const rejection = createNotificationDraft(fixture.repositories, scenario.actorId, request);

          if (isEmpty) {
            // 8.4: no recipients selected.
            await expect(rejection).rejects.toMatchObject({
              code: "VALIDATION_ERROR",
              fieldErrors: { recipientIds: [RECIPIENTS_ERROR_MESSAGE] },
            } satisfies Partial<ApplicationError>);
          } else if (!hasDuplicate) {
            // 8.3: a non-friend in an otherwise valid request.
            await expect(rejection).rejects.toMatchObject({
              code: "FORBIDDEN",
              message: NON_FRIEND_RECIPIENT_ERROR_MESSAGE,
            } satisfies Partial<ApplicationError>);
          } else {
            await expect(rejection).rejects.toBeInstanceOf(ApplicationError);
          }

          expect(fixture.createCalls()).toBe(0);
          expect(fixture.persistedDrafts).toEqual([]);
          return;
        }

        // 8.2: a non-empty, duplicate-free friend subset is stored as exactly the requested IDs.
        const draft = await createNotificationDraft(fixture.repositories, scenario.actorId, request);
        const expectedTarget = { recipientIds: [...scenario.recipientIds] };

        expect(fixture.persistedDrafts).toEqual([draft]);
        expect(draft).toMatchObject({ ownerId: scenario.actorId, mode: "PERSONAL" });
        expect(draft.targetJson).toEqual(expectedTarget);

        // Snapshot: later friendship changes and caller-side mutation do not alter stored IDs.
        fixture.changeActorFriends(scenario.removedFriendIds, scenario.addedFriendIds);
        requestedRecipientIds.splice(0, requestedRecipientIds.length, scenario.actorId);

        const currentFriendSet = new Set(
          [...scenario.friendIds, ...scenario.addedFriendIds].filter(
            (id) => !scenario.removedFriendIds.includes(id),
          ),
        );
        expect(await selectableRecipientIds(fixture.repositories, scenario.actorId)).toEqual(
          currentFriendSet,
        );
        expect(draft.targetJson).toEqual(expectedTarget);
        expect(fixture.persistedDrafts.map((stored) => stored.targetJson)).toEqual([
          expectedTarget,
        ]);
      }),
      { numRuns: 200 },
    );
  });
});
