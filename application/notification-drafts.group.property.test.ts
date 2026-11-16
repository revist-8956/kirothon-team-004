import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ApplicationError } from "./action-result";
import { createNotificationDraft, getComposeOptions } from "./notification-drafts";
import type {
  CreateDraftInput,
  MembershipRecord,
  NotificationDraftRecord,
  RepositoryTransaction,
  RepositoryUnitOfWork,
} from "./repositories";

const clock = new Date("2026-03-01T01:02:03.000Z");
const leftAt = new Date("2026-02-01T00:00:00.000Z");
const ACTOR_ID = "a0000000-0000-4000-8000-000000000001";
const OTHER_USER_IDS = [
  "b0000000-0000-4000-8000-000000000001",
  "b0000000-0000-4000-8000-000000000002",
] as const;
const GROUP_ACCESS_ERROR_MESSAGE = "선택한 그룹에 알림을 보낼 권한이 없어요.";
const MULTIPLE_GROUPS_ERROR_MESSAGE = "그룹은 하나만 지정할 수 있어요.";
const SENTENCE = "그룹 공지를 확인해 주세요";

/**
 * Actor membership history for one group. Only ACTIVE and REJOINED leave an
 * active row (`leftAt === null`); the other states model a non-member.
 */
type ActorMembershipState = "ACTIVE" | "LEFT" | "NEVER" | "REJOINED" | "LEFT_TWICE";

type GroupTargetInput =
  | { readonly kind: "single"; readonly index: number }
  | { readonly kind: "unknown" }
  | { readonly kind: "multiple"; readonly indices: readonly number[] }
  | { readonly kind: "missing" }
  | { readonly kind: "malformed"; readonly value: unknown };

interface GroupScenario {
  readonly groupIds: readonly string[];
  readonly unknownGroupId: string;
  readonly actorStates: readonly ActorMembershipState[];
  readonly otherMemberships: readonly (readonly ("ACTIVE" | "LEFT" | "NONE")[])[];
  readonly input: GroupTargetInput;
}

function membershipRow(
  sequence: number,
  groupId: string,
  userId: string,
  active: boolean,
): MembershipRecord {
  return {
    id: `c0000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    groupId,
    userId,
    joinedAt: leftAt,
    leftAt: active ? null : leftAt,
    emailVisibility: "PRIVATE",
    createdAt: leftAt,
  };
}

function buildMemberships(scenario: GroupScenario): MembershipRecord[] {
  const rows: MembershipRecord[] = [];
  const push = (groupId: string, userId: string, active: boolean) =>
    rows.push(membershipRow(rows.length + 1, groupId, userId, active));

  scenario.groupIds.forEach((groupId, groupIndex) => {
    switch (scenario.actorStates[groupIndex]) {
      case "ACTIVE":
        push(groupId, ACTOR_ID, true);
        break;
      case "LEFT":
        push(groupId, ACTOR_ID, false);
        break;
      case "REJOINED":
        push(groupId, ACTOR_ID, false);
        push(groupId, ACTOR_ID, true);
        break;
      case "LEFT_TWICE":
        push(groupId, ACTOR_ID, false);
        push(groupId, ACTOR_ID, false);
        break;
      case "NEVER":
      case undefined:
        break;
    }
    scenario.otherMemberships[groupIndex]?.forEach((state, userIndex) => {
      const userId = OTHER_USER_IDS[userIndex]!;
      if (state !== "NONE") push(groupId, userId, state === "ACTIVE");
    });
  });
  return rows;
}

/**
 * In-memory repository that follows the repository contract: a membership is
 * current only while `leftAt` is null, and listing/finding use that predicate.
 */
function createFixture(memberships: readonly MembershipRecord[]) {
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
          .filter((row) => row.userId === userId && row.leftAt === null)
          .map((row) => ({
            id: row.groupId,
            name: `그룹 ${row.groupId}`,
            memberCount: memberships.filter(
              (other) => other.groupId === row.groupId && other.leftAt === null,
            ).length,
            latestDispatchSentAt: null,
          })),
    },
    memberships: {
      findCurrent: async (groupId: string, userId: string) =>
        memberships.find(
          (row) => row.groupId === groupId && row.userId === userId && row.leftAt === null,
        ) ?? null,
    },
    drafts: {
      create: async (input: CreateDraftInput) => {
        const draft: NotificationDraftRecord = {
          id: `d0000000-0000-4000-8000-${String(drafts.length + 1).padStart(12, "0")}`,
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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const groupScenarioArbitrary: fc.Arbitrary<GroupScenario> = fc
  .integer({ min: 1, max: 6 })
  .chain((groupCount) =>
    fc.record({
      ids: fc.uniqueArray(fc.uuid({ version: 4 }), {
        minLength: groupCount + 1,
        maxLength: groupCount + 1,
      }),
      actorStates: fc.array(
        fc.constantFrom<ActorMembershipState>("ACTIVE", "LEFT", "NEVER", "REJOINED", "LEFT_TWICE"),
        { minLength: groupCount, maxLength: groupCount },
      ),
      otherMemberships: fc.array(
        fc.array(fc.constantFrom<"ACTIVE" | "LEFT" | "NONE">("ACTIVE", "LEFT", "NONE"), {
          minLength: OTHER_USER_IDS.length,
          maxLength: OTHER_USER_IDS.length,
        }),
        { minLength: groupCount, maxLength: groupCount },
      ),
      input: fc.oneof(
        fc.record({ kind: fc.constant("single" as const), index: fc.nat({ max: groupCount - 1 }) }),
        fc.constant({ kind: "unknown" as const }),
        fc.record({
          kind: fc.constant("multiple" as const),
          // Index `groupCount` refers to the unknown group, so mixed known/unknown arrays are covered.
          indices: fc.uniqueArray(fc.nat({ max: groupCount }), {
            minLength: 2,
            maxLength: groupCount + 1,
          }),
        }),
        fc.constant({ kind: "missing" as const }),
        fc.record({
          kind: fc.constant("malformed" as const),
          value: fc.oneof(
            fc.string().filter((value) => !uuidPattern.test(value)),
            fc.integer(),
            fc.constant(null),
            fc.dictionary(fc.string(), fc.string(), { maxKeys: 2 }),
          ),
        }),
      ),
    }),
  )
  .map(({ ids, actorStates, otherMemberships, input }) => ({
    groupIds: ids.slice(0, -1),
    unknownGroupId: ids[ids.length - 1]!,
    actorStates,
    otherMemberships,
    input,
  }));

function draftInputFor(scenario: GroupScenario): Record<string, unknown> {
  const base: Record<string, unknown> = { sentence: SENTENCE, mode: "GROUP" };
  const allIds = [...scenario.groupIds, scenario.unknownGroupId];
  switch (scenario.input.kind) {
    case "single":
      return { ...base, groupId: scenario.groupIds[scenario.input.index] };
    case "unknown":
      return { ...base, groupId: scenario.unknownGroupId };
    case "multiple":
      return { ...base, groupId: scenario.input.indices.map((index) => allIds[index]) };
    case "missing":
      return base;
    case "malformed":
      return { ...base, groupId: scenario.input.value };
  }
}

function isActorCurrentMember(state: ActorMembershipState | undefined): boolean {
  return state === "ACTIVE" || state === "REJOINED";
}

describe("group notification target selection and registration authorization", () => {
  // Feature: personal-group-notifications, Property 11: 그룹 대상 선택과 등록 권한
  // **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**
  it("offers only active-membership groups and registers exactly one group only for its current member", async () => {
    await fc.assert(
      fc.asyncProperty(groupScenarioArbitrary, async (scenario) => {
        const { repositories, drafts, locks } = createFixture(buildMemberships(scenario));

        // 9.1: selectable groups equal the actor's current-membership groups.
        const expectedSelectable = scenario.groupIds.filter((_, index) =>
          isActorCurrentMember(scenario.actorStates[index]),
        );
        const options = await getComposeOptions(repositories, ACTOR_ID, "GROUP");
        if (options.mode !== "GROUP") {
          throw new Error("Group compose options must keep the GROUP mode.");
        }
        const offeredIds = options.groups.map((group) => group.id);
        expect(new Set(offeredIds).size).toBe(offeredIds.length);
        expect([...offeredIds].sort()).toEqual([...expectedSelectable].sort());

        const input = draftInputFor(scenario);
        const selectedGroupId =
          scenario.input.kind === "single" || scenario.input.kind === "unknown"
            ? (input.groupId as string)
            : undefined;

        // 9.4: a single target is registered iff the actor currently belongs to it,
        // which is the same predicate that defines the selectable set.
        if (selectedGroupId !== undefined && expectedSelectable.includes(selectedGroupId)) {
          const draft = await createNotificationDraft(repositories, ACTOR_ID, input);
          expect(draft).toMatchObject({
            ownerId: ACTOR_ID,
            sentence: SENTENCE,
            mode: "GROUP",
            targetJson: { groupId: selectedGroupId },
          });
          expect(drafts).toEqual([draft]);
          expect(locks).toEqual([selectedGroupId]);
          return;
        }

        const rejection = createNotificationDraft(repositories, ACTOR_ID, input);

        if (selectedGroupId !== undefined) {
          // 9.5: left, never-joined, and nonexistent groups are forbidden.
          await expect(rejection).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: GROUP_ACCESS_ERROR_MESSAGE,
          } satisfies Partial<ApplicationError>);
          expect(locks).toEqual([selectedGroupId]);
        } else if (scenario.input.kind === "multiple") {
          // 9.2, 9.3: two or more groups are rejected with the single-group message.
          await expect(rejection).rejects.toMatchObject({
            code: "VALIDATION_ERROR",
            message: MULTIPLE_GROUPS_ERROR_MESSAGE,
          } satisfies Partial<ApplicationError>);
          expect(locks).toEqual([]);
        } else {
          // 9.2: a group notification without one valid group target is not registered.
          await expect(rejection).rejects.toMatchObject({
            code: "VALIDATION_ERROR",
          } satisfies Partial<ApplicationError>);
          expect(locks).toEqual([]);
        }
        expect(drafts).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
