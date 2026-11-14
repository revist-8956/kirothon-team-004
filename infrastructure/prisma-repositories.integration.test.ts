import { randomUUID } from "node:crypto";

import { PrismaClient, type EmailVisibility } from "@prisma/client";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";

import { setGroupEmailVisibility } from "../application/group-memberships";
import { getGroupDetail, getGroups } from "../application/group-queries";
import { getInvite, hashInviteToken, issueInvite } from "../application/invites";
import { PrismaRepositoryUnitOfWork } from "./prisma-repositories";
import { registerIsolatedPostgres } from "../tests/database/postgres-test-database";

const fixture = registerIsolatedPostgres();
const clients: PrismaClient[] = [];

function createRepositories(): PrismaRepositoryUnitOfWork {
  const client = new PrismaClient({
    datasources: { db: { url: fixture.current.url } },
  });
  clients.push(client);
  return new PrismaRepositoryUnitOfWork(client);
}

async function createUser(repositories: PrismaRepositoryUnitOfWork, nickname: string) {
  return repositories.transaction((transaction) =>
    transaction.users.create({
      email: `${randomUUID()}@example.test`,
      emailNormalized: `${randomUUID()}@example.test`,
      nickname,
      nicknameRequired: false,
    }),
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
});

describe("PrismaRepositoryUnitOfWork", () => {
  it("persists typed records and atomically consumes an available draft", async () => {
    const repositories = createRepositories();
    const owner = await createUser(repositories, "소유자");
    const expiry = new Date(Date.now() + 60_000);

    const result = await repositories.transaction(async (transaction) => {
      const draft = await transaction.drafts.create({
        ownerId: owner.id,
        sentence: "회의를 확인해 주세요",
        mode: "PERSONAL",
        targetJson: { recipientIds: [owner.id] },
        expiresAt: expiry,
      });
      const consumed = await transaction.drafts.consumeAvailable(draft.id, owner.id);
      const replay = await transaction.drafts.consumeAvailable(draft.id, owner.id);

      return { draft, consumed, replay };
    });

    expect(result.draft.ownerId).toBe(owner.id);
    expect(result.consumed?.id).toBe(result.draft.id);
    expect(result.consumed?.consumedAt).toBeInstanceOf(Date);
    expect(result.replay).toBeNull();
  });

  it("uses a stable database transaction timestamp for conditional membership and confirmation updates", async () => {
    const repositories = createRepositories();
    const owner = await createUser(repositories, "발신자");
    const recipient = await createUser(repositories, "수신자");

    const state = await repositories.transaction(async (transaction) => {
      const group = await transaction.groups.create({ name: "운영팀", createdById: owner.id });
      const membership = await transaction.memberships.create({ groupId: group.id, userId: recipient.id });
      const notification = await transaction.notifications.create({
        senderId: owner.id,
        sentence: "점검해 주세요",
        mode: "PERSONAL",
        scheduleKind: "ONE_TIME",
        oneTimeAt: new Date(Date.now() + 60_000),
      });
      const claim = await transaction.claims.create({
        notificationId: notification.id,
        effectiveDate: new Date("2026-01-02T00:00:00.000Z"),
        sourceDates: [new Date("2026-01-02T00:00:00.000Z")],
        state: "SENT",
      });
      const now = await transaction.now();
      const timestamp = await transaction.transactionTimestamp();
      const dispatch = await transaction.dispatches.create({
        notificationId: notification.id,
        claimId: claim.id,
        sequence: 1,
        scheduledDate: new Date("2026-01-02T00:00:00.000Z"),
        effectiveDate: new Date("2026-01-02T00:00:00.000Z"),
        sentAt: timestamp,
      });
      await transaction.dispatches.createRecipients(dispatch.id, [
        { recipientId: recipient.id, recipientNicknameSnapshot: recipient.nickname },
      ]);
      const confirmed = await transaction.dispatches.confirmRecipient(dispatch.id, recipient.id);
      const confirmationReplay = await transaction.dispatches.confirmRecipient(dispatch.id, recipient.id);
      const left = await transaction.memberships.leaveCurrent(group.id, recipient.id);
      const leaveReplay = await transaction.memberships.leaveCurrent(group.id, recipient.id);

      return { now, timestamp, confirmed, confirmationReplay, left, leaveReplay, membership };
    });

    expect(state.now.getTime()).toBe(state.timestamp.getTime());
    expect(state.confirmed?.confirmedAt?.getTime()).toBe(state.timestamp.getTime());
    expect(state.confirmationReplay).toBeNull();
    expect(state.left?.leftAt?.getTime()).toBe(state.timestamp.getTime());
    expect(state.leaveReplay).toBeNull();
    expect(state.left?.id).toBe(state.membership.id);
  });

  it("serializes concurrent group work with a transaction-scoped advisory lock", async () => {
    const firstRepositories = createRepositories();
    const secondRepositories = createRepositories();
    const owner = await createUser(firstRepositories, "잠금 소유자");
    const group = await firstRepositories.transaction((transaction) =>
      transaction.groups.create({ name: "잠금 그룹", createdById: owner.id }),
    );
    const firstAcquired = deferred();
    const releaseFirst = deferred();
    const secondAcquired = deferred();

    const first = firstRepositories.transaction(async (transaction) => {
      await transaction.lockGroup(group.id);
      firstAcquired.resolve();
      await releaseFirst.promise;
    });
    await firstAcquired.promise;

    const second = secondRepositories.transaction(async (transaction) => {
      await transaction.lockGroup(group.id);
      secondAcquired.resolve();
    });

    const blocked = await Promise.race([
      secondAcquired.promise.then(() => false),
      new Promise<true>((resolve) => setTimeout(() => resolve(true), 25)),
    ]);
    expect(blocked).toBe(true);

    releaseFirst.resolve();
    await Promise.all([first, second]);
  });
});


describe("group projections", () => {
  it("limits lists and detail data to current memberships and public emails", async () => {
    const repositories = createRepositories();
    const viewer = await createUser(repositories, "조회자");
    const publicMember = await createUser(repositories, "공개 구성원");
    const privateMember = await createUser(repositories, "비공개 구성원");
    const outsider = await createUser(repositories, "외부 사용자");
    const sentAt = new Date("2026-02-03T04:05:06.000Z");

    const state = await repositories.transaction(async (transaction) => {
      const group = await transaction.groups.create({ name: "현재 그룹", createdById: viewer.id });
      const otherGroup = await transaction.groups.create({ name: "다른 현재 그룹", createdById: viewer.id });
      const departedGroup = await transaction.groups.create({ name: "탈퇴한 그룹", createdById: viewer.id });

      await transaction.memberships.create({ groupId: group.id, userId: viewer.id });
      await transaction.memberships.create({
        groupId: group.id,
        userId: publicMember.id,
        emailVisibility: "PUBLIC",
      });
      await transaction.memberships.create({ groupId: group.id, userId: privateMember.id });
      await transaction.memberships.create({
        groupId: otherGroup.id,
        userId: viewer.id,
        emailVisibility: "PUBLIC",
      });
      await transaction.memberships.create({ groupId: departedGroup.id, userId: viewer.id });
      await transaction.memberships.leaveCurrent(departedGroup.id, viewer.id);

      const notification = await transaction.notifications.create({
        senderId: viewer.id,
        sentence: "현재 그룹 공지",
        mode: "GROUP",
        groupId: group.id,
        scheduleKind: "ONE_TIME",
        oneTimeAt: sentAt,
      });
      const claim = await transaction.claims.create({
        notificationId: notification.id,
        effectiveDate: new Date("2026-02-03T00:00:00.000Z"),
        sourceDates: [new Date("2026-02-03T00:00:00.000Z")],
        state: "SENT",
      });
      await transaction.dispatches.create({
        notificationId: notification.id,
        claimId: claim.id,
        sequence: 1,
        scheduledDate: new Date("2026-02-03T00:00:00.000Z"),
        effectiveDate: new Date("2026-02-03T00:00:00.000Z"),
        sentAt,
      });

      return { group, otherGroup, departedGroup };
    });

    const groups = await getGroups(viewer.id, repositories);
    expect(groups).toHaveLength(2);
    expect(groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: state.group.id,
          name: "현재 그룹",
          memberCount: 3,
          latestDispatchSentAt: sentAt,
        }),
        expect.objectContaining({
          id: state.otherGroup.id,
          name: "다른 현재 그룹",
          memberCount: 1,
          latestDispatchSentAt: null,
        }),
      ]),
    );
    expect(groups.map((group) => group.id)).not.toContain(state.departedGroup.id);

    const detail = await getGroupDetail(state.group.id, viewer.id, repositories);
    expect(detail).toMatchObject({ id: state.group.id, emailVisibility: "PRIVATE" });
    expect(detail?.members).toEqual(
      expect.arrayContaining([
        { userId: publicMember.id, nickname: publicMember.nickname, email: publicMember.email },
        { userId: privateMember.id, nickname: privateMember.nickname },
        { userId: viewer.id, nickname: viewer.nickname },
      ]),
    );
    expect(detail?.members.find((member) => member.userId === privateMember.id)).not.toHaveProperty("email");
    expect(detail?.members.find((member) => member.userId === viewer.id)).not.toHaveProperty("email");

    const forbiddenDetail = await getGroupDetail(state.group.id, outsider.id, repositories);
    expect(forbiddenDetail).toBeNull();

    await repositories.transaction(async (transaction) => {
      await transaction.memberships.updateCurrentVisibility(state.group.id, viewer.id, "PUBLIC");
      expect(await transaction.memberships.findCurrent(state.otherGroup.id, viewer.id)).toMatchObject({
        emailVisibility: "PUBLIC",
      });
    });
  });

  // Feature: personal-group-notifications, Property 8: 그룹별 이메일 공개의 최소 노출과 비간섭
  // Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
  it("returns every member but exposes only PUBLIC emails, preserves other-group settings, and denies outsiders", async () => {
    const repositories = createRepositories();
    const memberVisibilities = fc.array(fc.constantFrom<EmailVisibility>("PRIVATE", "PUBLIC"), {
      minLength: 1,
      maxLength: 8,
    });
    const visibility = fc.constantFrom<EmailVisibility>("PRIVATE", "PUBLIC");

    await fc.assert(
      fc.asyncProperty(memberVisibilities, visibility, visibility, async (initialVisibilities, nextVisibility, otherGroupVisibility) => {
        const viewer = await createUser(repositories, "조회자");
        const outsider = await createUser(repositories, "외부 사용자");
        const members = [viewer];

        for (let index = 1; index < initialVisibilities.length; index += 1) {
          members.push(await createUser(repositories, `구성원 ${index}`));
        }

        const { group, otherGroup } = await repositories.transaction(async (transaction) => {
          const group = await transaction.groups.create({
            name: `공개 설정 검사 ${randomUUID()}`,
            createdById: viewer.id,
          });
          const otherGroup = await transaction.groups.create({
            name: `다른 그룹 검사 ${randomUUID()}`,
            createdById: viewer.id,
          });

          await Promise.all(
            members.map((member, index) =>
              transaction.memberships.create({
                groupId: group.id,
                userId: member.id,
                emailVisibility: initialVisibilities[index]!,
              }),
            ),
          );
          await transaction.memberships.create({
            groupId: otherGroup.id,
            userId: viewer.id,
            emailVisibility: otherGroupVisibility,
          });

          return { group, otherGroup };
        });

        await setGroupEmailVisibility(repositories, {
          actorId: viewer.id,
          groupId: group.id,
          emailVisibility: nextVisibility,
        });

        const detail = await getGroupDetail(group.id, viewer.id, repositories);
        expect(detail).not.toBeNull();
        if (!detail) {
          throw new Error("A current member must receive the group projection");
        }

        const expectedVisibilities = [nextVisibility, ...initialVisibilities.slice(1)];
        expect(detail.members).toHaveLength(members.length);
        expect(detail.members.map((member) => member.userId).sort()).toEqual(
          members.map((member) => member.id).sort(),
        );

        for (const [index, member] of members.entries()) {
          const projectedMember = detail.members.find(({ userId }) => userId === member.id);
          expect(projectedMember).toMatchObject({ userId: member.id, nickname: member.nickname });

          if (expectedVisibilities[index] === "PUBLIC") {
            expect(projectedMember?.email).toBe(member.email);
          } else {
            expect(projectedMember).not.toHaveProperty("email");
          }
        }

        const otherMembership = await repositories.transaction((transaction) =>
          transaction.memberships.findCurrent(otherGroup.id, viewer.id),
        );
        expect(otherMembership?.emailVisibility).toBe(otherGroupVisibility);
        await expect(getGroupDetail(group.id, outsider.id, repositories)).resolves.toBeNull();
      }),
      { numRuns: 100 },
    );
  }, 30_000);
});


describe("invite issuance and lookup", () => {
  it("stores only a hash, projects valid invites, and refuses non-members", async () => {
    const repositories = createRepositories();
    const issuer = await createUser(repositories, "초대자");
    const member = await createUser(repositories, "기존 구성원");
    const outsider = await createUser(repositories, "외부 사용자");

    const group = await repositories.transaction(async (transaction) => {
      const created = await transaction.groups.create({
        name: "초대 테스트 그룹",
        createdById: issuer.id,
      });
      await transaction.memberships.create({ groupId: created.id, userId: issuer.id });
      await transaction.memberships.create({ groupId: created.id, userId: member.id });
      return created;
    });

    const issued = await issueInvite(repositories, { groupId: group.id, issuerId: issuer.id });
    const stored = await fixture.current.pool.query<{ token_hash: string }>(
      'SELECT "token_hash" FROM "invites" WHERE "group_id" = $1',
      [group.id],
    );

    expect(Buffer.from(issued.rawToken, "base64url")).toHaveLength(32);
    expect(stored.rows).toEqual([{ token_hash: hashInviteToken(issued.rawToken) }]);
    expect(stored.rows[0]?.token_hash).not.toBe(issued.rawToken);

    await expect(
      issueInvite(repositories, { groupId: group.id, issuerId: outsider.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(getInvite(repositories, "malformed token", outsider.id)).resolves.toBeNull();
    await expect(getInvite(repositories, issued.rawToken, outsider.id)).resolves.toEqual({
      groupId: group.id,
      groupName: "초대 테스트 그룹",
      inviterNickname: issuer.nickname,
      currentMemberCount: 2,
      alreadyMember: false,
      returnTo: `/invite/${issued.rawToken}`,
    });
    await expect(getInvite(repositories, issued.rawToken, member.id)).resolves.toMatchObject({
      alreadyMember: true,
    });
  });
});
