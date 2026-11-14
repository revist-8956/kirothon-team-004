import { randomUUID } from "node:crypto";

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  acceptGroupInvite,
  createGroup,
  leaveGroup,
  setGroupEmailVisibility,
} from "./group-memberships";
import type {
  GroupRecord,
  MembershipRecord,
  RepositoryTransaction,
  RepositoryUnitOfWork,
  UserRecord,
} from "./repositories";

interface TestState {
  users: Map<string, UserRecord>;
  groups: Map<string, GroupRecord>;
  memberships: MembershipRecord[];
  locks: string[];
  clock: Date;
  transactionCount: number;
  failMembershipCreation: boolean;
}

function createRepositoryFixture(): {
  repositories: RepositoryUnitOfWork;
  state: TestState;
  createUser: () => UserRecord;
} {
  let groupSequence = 0;
  let membershipSequence = 0;
  const state: TestState = {
    users: new Map(),
    groups: new Map(),
    memberships: [],
    locks: [],
    clock: new Date("2026-02-03T04:05:06.000Z"),
    transactionCount: 0,
    failMembershipCreation: false,
  };
  const createUser = (): UserRecord => {
    const id = randomUUID();
    const user: UserRecord = {
      id,
      email: `${id}@example.test`,
      emailNormalized: `${id}@example.test`,
      nickname: "사용자",
      nicknameRequired: false,
      createdAt: state.clock,
      updatedAt: state.clock,
    };
    state.users.set(id, user);
    return user;
  };

  const repositories: RepositoryUnitOfWork = {
    async transaction<T>(work: (transaction: RepositoryTransaction) => Promise<T>): Promise<T> {
      state.transactionCount += 1;
      const snapshot = {
        groups: new Map(state.groups),
        memberships: state.memberships.map((membership) => ({ ...membership })),
        locks: [...state.locks],
      };
      const transaction = {
        users: {
          findById: async (id: string) => state.users.get(id) ?? null,
        },
        groups: {
          findById: async (id: string) => state.groups.get(id) ?? null,
          create: async ({ name, createdById }: { name: string; createdById: string }) => {
            const group: GroupRecord = {
              id: `00000000-0000-4000-8000-${String(++groupSequence).padStart(12, "0")}`,
              name,
              createdById,
              createdAt: state.clock,
            };
            state.groups.set(group.id, group);
            return group;
          },
        },
        memberships: {
          findCurrent: async (groupId: string, userId: string) =>
            state.memberships.find(
              (membership) =>
                membership.groupId === groupId && membership.userId === userId && membership.leftAt === null,
            ) ?? null,
          create: async ({
            groupId,
            userId,
            joinedAt = state.clock,
            emailVisibility = "PRIVATE",
          }: {
            groupId: string;
            userId: string;
            joinedAt?: Date;
            emailVisibility?: "PRIVATE" | "PUBLIC";
          }) => {
            if (state.failMembershipCreation) {
              throw new Error("membership write failed");
            }
            const membership: MembershipRecord = {
              id: `10000000-0000-4000-8000-${String(++membershipSequence).padStart(12, "0")}`,
              groupId,
              userId,
              joinedAt,
              leftAt: null,
              emailVisibility,
              createdAt: state.clock,
            };
            state.memberships.push(membership);
            return membership;
          },
          leaveCurrent: async (groupId: string, userId: string) => {
            const index = state.memberships.findIndex(
              (membership) =>
                membership.groupId === groupId && membership.userId === userId && membership.leftAt === null,
            );
            if (index === -1) return null;
            const leftMembership = { ...state.memberships[index]!, leftAt: state.clock };
            state.memberships[index] = leftMembership;
            return leftMembership;
          },
          updateCurrentVisibility: async (
            groupId: string,
            userId: string,
            emailVisibility: "PRIVATE" | "PUBLIC",
          ) => {
            const index = state.memberships.findIndex(
              (membership) =>
                membership.groupId === groupId && membership.userId === userId && membership.leftAt === null,
            );
            if (index === -1) return null;
            const updatedMembership = { ...state.memberships[index]!, emailVisibility };
            state.memberships[index] = updatedMembership;
            return updatedMembership;
          },
        },
        lockGroup: async (groupId: string) => {
          state.locks.push(groupId);
        },
        transactionTimestamp: async () => state.clock,
      } as unknown as RepositoryTransaction;

      try {
        return await work(transaction);
      } catch (error) {
        state.groups = snapshot.groups;
        state.memberships = snapshot.memberships;
        state.locks = snapshot.locks;
        throw error;
      }
    },
  };

  return { repositories, state, createUser };
}

describe("group membership commands", () => {
  it("creates a trimmed group and private creator membership in one transaction", async () => {
    const { repositories, state, createUser } = createRepositoryFixture();
    const creator = createUser();

    const result = await createGroup(repositories, { actorId: creator.id, name: "  운영팀  " });

    expect(state.transactionCount).toBe(1);
    expect(result.group.name).toBe("운영팀");
    expect(result.membership).toMatchObject({
      groupId: result.group.id,
      userId: creator.id,
      joinedAt: state.clock,
      emailVisibility: "PRIVATE",
      leftAt: null,
    });
  });

  it("rolls back the new group if creator membership creation fails", async () => {
    const { repositories, state, createUser } = createRepositoryFixture();
    const creator = createUser();
    state.failMembershipCreation = true;

    await expect(createGroup(repositories, { actorId: creator.id, name: "운영팀" })).rejects.toThrow(
      "membership write failed",
    );

    expect(state.groups).toHaveLength(0);
    expect(state.memberships).toHaveLength(0);
  });

  it("keeps an active acceptance unchanged and creates a private new history after rejoining", async () => {
    const { repositories, state, createUser } = createRepositoryFixture();
    const creator = createUser();
    const invitee = createUser();
    const { group } = await createGroup(repositories, { actorId: creator.id, name: "운영팀" });

    const first = await acceptGroupInvite(repositories, { actorId: invitee.id, groupId: group.id });
    const publicMembership = await setGroupEmailVisibility(repositories, {
      actorId: invitee.id,
      groupId: group.id,
      emailVisibility: "PUBLIC",
    });
    state.clock = new Date("2026-02-04T04:05:06.000Z");
    const repeated = await acceptGroupInvite(repositories, { actorId: invitee.id, groupId: group.id });
    await leaveGroup(repositories, { actorId: invitee.id, groupId: group.id, confirmation: true });
    state.clock = new Date("2026-02-05T04:05:06.000Z");
    const rejoined = await acceptGroupInvite(repositories, { actorId: invitee.id, groupId: group.id });

    expect(first.alreadyMember).toBe(false);
    expect(publicMembership.emailVisibility).toBe("PUBLIC");
    expect(repeated).toEqual({ membership: publicMembership, alreadyMember: true });
    expect(rejoined).toMatchObject({ alreadyMember: false });
    expect(rejoined.membership).toMatchObject({
      userId: invitee.id,
      groupId: group.id,
      joinedAt: state.clock,
      emailVisibility: "PRIVATE",
      leftAt: null,
    });
    expect(rejoined.membership.id).not.toBe(first.membership.id);
    expect(state.locks).toEqual([group.id, group.id, group.id, group.id]);
  });

  it("requires confirmation and conditionally ends only the active membership under the group lock", async () => {
    const { repositories, state, createUser } = createRepositoryFixture();
    const creator = createUser();
    const { group } = await createGroup(repositories, { actorId: creator.id, name: "운영팀" });

    await expect(
      leaveGroup(repositories, { actorId: creator.id, groupId: group.id, confirmation: false }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(state.memberships[0]?.leftAt).toBeNull();

    const left = await leaveGroup(repositories, {
      actorId: creator.id,
      groupId: group.id,
      confirmation: true,
    });
    await expect(
      leaveGroup(repositories, { actorId: creator.id, groupId: group.id, confirmation: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(left.leftAt).toEqual(state.clock);
    expect(state.locks).toEqual([group.id]);
  });

  it("changes only the caller's current membership and rejects an external user", async () => {
    const { repositories, state, createUser } = createRepositoryFixture();
    const creator = createUser();
    const otherUser = createUser();
    const first = await createGroup(repositories, { actorId: creator.id, name: "첫 그룹" });
    const second = await createGroup(repositories, { actorId: creator.id, name: "둘째 그룹" });

    const updated = await setGroupEmailVisibility(repositories, {
      actorId: creator.id,
      groupId: first.group.id,
      emailVisibility: "PUBLIC",
    });
    await expect(
      setGroupEmailVisibility(repositories, {
        actorId: otherUser.id,
        groupId: first.group.id,
        emailVisibility: "PUBLIC",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(updated.emailVisibility).toBe("PUBLIC");
    expect(
      state.memberships.find((membership) => membership.groupId === second.group.id)?.emailVisibility,
    ).toBe("PRIVATE");
  });
});

interface MembershipHistoryModel {
  readonly joinedAt: number;
  leftAt: number | null;
  emailVisibility: "PRIVATE" | "PUBLIC";
}

interface MembershipStateModel {
  readonly history: MembershipHistoryModel[];
  nextTimestamp: number;
}

interface MembershipCommandSystem {
  readonly repositories: RepositoryUnitOfWork;
  readonly state: TestState;
  readonly actorId: string;
  readonly groupId: string;
}

function advanceMembershipClock(
  model: MembershipStateModel,
  system: MembershipCommandSystem,
): Date {
  const now = new Date(model.nextTimestamp);
  model.nextTimestamp += 1;
  system.state.clock = now;
  return now;
}

function activeModelMembership(model: MembershipStateModel): MembershipHistoryModel | undefined {
  return model.history.find((membership) => membership.leftAt === null);
}

function assertMembershipSystemMatchesModel(
  model: MembershipStateModel,
  system: MembershipCommandSystem,
): void {
  const history = system.state.memberships.filter(
    (membership) => membership.groupId === system.groupId && membership.userId === system.actorId,
  );
  const activeHistory = history.filter((membership) => membership.leftAt === null);
  const activeModel = activeModelMembership(model);

  expect(activeHistory).toHaveLength(activeModel ? 1 : 0);
  expect(history).toHaveLength(model.history.length);
  expect(
    history.map((membership) => ({
      joinedAt: membership.joinedAt.getTime(),
      leftAt: membership.leftAt?.getTime() ?? null,
      emailVisibility: membership.emailVisibility,
    })),
  ).toEqual(model.history);

  if (activeModel) {
    expect(activeHistory[0]).toMatchObject({
      joinedAt: new Date(activeModel.joinedAt),
      emailVisibility: activeModel.emailVisibility,
      leftAt: null,
    });
  }
}

class ViewInviteCommand implements fc.AsyncCommand<MembershipStateModel, MembershipCommandSystem> {
  check = (): boolean => true;

  async run(model: MembershipStateModel, system: MembershipCommandSystem): Promise<void> {
    advanceMembershipClock(model, system);

    // Opening an invitation is read-only: it cannot add an active membership.
    assertMembershipSystemMatchesModel(model, system);
  }

  toString = (): string => "view invite";
}

class AcceptInviteCommand implements fc.AsyncCommand<MembershipStateModel, MembershipCommandSystem> {
  check = (): boolean => true;

  async run(model: MembershipStateModel, system: MembershipCommandSystem): Promise<void> {
    const now = advanceMembershipClock(model, system);
    const activeMembership = activeModelMembership(model);
    const result = await acceptGroupInvite(system.repositories, {
      actorId: system.actorId,
      groupId: system.groupId,
    });

    if (activeMembership) {
      expect(result).toMatchObject({ alreadyMember: true });
      expect(result.membership).toMatchObject({
        joinedAt: new Date(activeMembership.joinedAt),
        emailVisibility: activeMembership.emailVisibility,
        leftAt: null,
      });
    } else {
      model.history.push({
        joinedAt: now.getTime(),
        leftAt: null,
        emailVisibility: "PRIVATE",
      });
      expect(result).toMatchObject({
        alreadyMember: false,
        membership: {
          joinedAt: now,
          emailVisibility: "PRIVATE",
          leftAt: null,
        },
      });
    }

    assertMembershipSystemMatchesModel(model, system);
  }

  toString = (): string => "accept invite";
}

class SetVisibilityCommand implements fc.AsyncCommand<MembershipStateModel, MembershipCommandSystem> {
  constructor(private readonly emailVisibility: "PRIVATE" | "PUBLIC") {}

  check = (model: Readonly<MembershipStateModel>): boolean => activeModelMembership(model) !== undefined;

  async run(model: MembershipStateModel, system: MembershipCommandSystem): Promise<void> {
    advanceMembershipClock(model, system);
    const membership = activeModelMembership(model);
    if (!membership) throw new Error("visibility command requires an active membership");

    const result = await setGroupEmailVisibility(system.repositories, {
      actorId: system.actorId,
      groupId: system.groupId,
      emailVisibility: this.emailVisibility,
    });
    membership.emailVisibility = this.emailVisibility;

    expect(result).toMatchObject({ emailVisibility: this.emailVisibility, leftAt: null });
    assertMembershipSystemMatchesModel(model, system);
  }

  toString = (): string => `set visibility ${this.emailVisibility}`;
}

class LeaveGroupCommand implements fc.AsyncCommand<MembershipStateModel, MembershipCommandSystem> {
  check = (model: Readonly<MembershipStateModel>): boolean => activeModelMembership(model) !== undefined;

  async run(model: MembershipStateModel, system: MembershipCommandSystem): Promise<void> {
    const now = advanceMembershipClock(model, system);
    const membership = activeModelMembership(model);
    if (!membership) throw new Error("leave command requires an active membership");

    const result = await leaveGroup(system.repositories, {
      actorId: system.actorId,
      groupId: system.groupId,
      confirmation: true,
    });
    membership.leftAt = now.getTime();

    expect(result).toMatchObject({ leftAt: now });
    assertMembershipSystemMatchesModel(model, system);
  }

  toString = (): string => "leave group";
}

describe("membership history state machine", () => {
  // Feature: personal-group-notifications, Property 6: 멤버십 이력 상태기계
  // Validates: Requirements 4.3, 4.5, 4.6, 4.7, 5.4
  it("preserves active history on re-acceptance and creates one private latest history after rejoining", async () => {
    const commandArbitraries = [
      fc.constant(new ViewInviteCommand()),
      fc.constant(new AcceptInviteCommand()),
      fc.constantFrom<"PRIVATE" | "PUBLIC">("PRIVATE", "PUBLIC").map(
        (emailVisibility) => new SetVisibilityCommand(emailVisibility),
      ),
      fc.constant(new LeaveGroupCommand()),
    ];

    await fc.assert(
      fc.asyncProperty(fc.commands(commandArbitraries, { maxCommands: 50 }), async (commands) => {
        const { repositories, state, createUser } = createRepositoryFixture();
        const groupCreator = createUser();
        const invitee = createUser();
        const { group } = await createGroup(repositories, {
          actorId: groupCreator.id,
          name: "상태기계 테스트 그룹",
        });
        const system: MembershipCommandSystem = {
          repositories,
          state,
          actorId: invitee.id,
          groupId: group.id,
        };
        const model: MembershipStateModel = {
          history: [],
          nextTimestamp: new Date("2026-02-04T00:00:00.000Z").getTime(),
        };

        await fc.asyncModelRun(() => ({ model, real: system }), commands);
        assertMembershipSystemMatchesModel(model, system);
      }),
      { numRuns: 100 },
    );
  });
});
