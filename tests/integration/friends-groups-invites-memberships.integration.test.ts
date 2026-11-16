import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { addFriend, getFriends } from "@/application/friends";
import {
  acceptGroupInvite,
  createGroup,
  leaveGroup,
  setGroupEmailVisibility,
} from "@/application/group-memberships";
import { getGroupDetail, getGroups } from "@/application/group-queries";
import { getInvite, issueInvite } from "@/application/invites";
import { PrismaRepositoryUnitOfWork } from "@/infrastructure/prisma-repositories";
import { registerIsolatedPostgres } from "@/tests/database/postgres-test-database";
import { createSupabaseProfileUser } from "@/tests/database/supabase-auth-schema";

const fixture = registerIsolatedPostgres();
const clients: PrismaClient[] = [];

function createRepositories(): PrismaRepositoryUnitOfWork {
  const client = new PrismaClient({
    datasources: { db: { url: fixture.current.url } },
  });
  clients.push(client);
  return new PrismaRepositoryUnitOfWork(client);
}

async function createUser(
  repositories: PrismaRepositoryUnitOfWork,
  nickname: string,
) {
  return createSupabaseProfileUser(fixture.current.pool, repositories, {
    email: `${randomUUID()}@example.test`,
    nickname,
  });
}

async function membershipHistory(groupId: string, userId: string) {
  return fixture.current.pool.query<{
    id: string;
    joined_at: Date;
    left_at: Date | null;
    email_visibility: "PRIVATE" | "PUBLIC";
  }>(
    `SELECT "id", "joined_at", "left_at", "email_visibility"
     FROM "memberships"
     WHERE "group_id" = $1 AND "user_id" = $2
     ORDER BY "created_at" ASC, "id" ASC`,
    [groupId, userId],
  );
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
});

describe("friends, groups, invites, and memberships against isolated PostgreSQL", () => {
  it("persists one directional friend relationship and preserves it when duplicate requests race", async () => {
    const firstRepositories = createRepositories();
    const secondRepositories = createRepositories();
    const owner = await createUser(firstRepositories, "소유자");
    const friend = await createUser(firstRepositories, "친구");

    const results = await Promise.allSettled([
      addFriend(firstRepositories, owner.id, { email: `  ${friend.email.toUpperCase()}  ` }),
      addFriend(secondRepositories, owner.id, { email: friend.email }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await getFriends(firstRepositories, owner.id)).toEqual([
      { nickname: friend.nickname, email: friend.email },
    ]);
    expect(await getFriends(firstRepositories, friend.id)).toEqual([]);

    const friendships = await fixture.current.pool.query<{
      owner_id: string;
      friend_id: string;
    }>(`SELECT "owner_id", "friend_id" FROM "friends"`);
    expect(friendships.rows).toEqual([{ owner_id: owner.id, friend_id: friend.id }]);
  });

  it("creates a group with its private creator membership and issues invites only to current members", async () => {
    const repositories = createRepositories();
    const creator = await createUser(repositories, "생성자");
    const outsider = await createUser(repositories, "외부 사용자");

    const created = await createGroup(repositories, {
      actorId: creator.id,
      name: "  운영팀  ",
    });

    expect(created.group.name).toBe("운영팀");
    expect(created.membership).toMatchObject({
      groupId: created.group.id,
      userId: creator.id,
      emailVisibility: "PRIVATE",
      leftAt: null,
    });
    expect(created.membership.joinedAt).toBeInstanceOf(Date);

    const persisted = await membershipHistory(created.group.id, creator.id);
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]).toMatchObject({
      id: created.membership.id,
      left_at: null,
      email_visibility: "PRIVATE",
    });

    const invite = await issueInvite(repositories, {
      groupId: created.group.id,
      issuerId: creator.id,
    });
    await expect(
      issueInvite(repositories, { groupId: created.group.id, issuerId: outsider.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(getInvite(repositories, invite.rawToken, outsider.id)).resolves.toMatchObject({
      groupId: created.group.id,
      groupName: "운영팀",
      alreadyMember: false,
    });
  });

  it("serializes concurrent invite acceptance into one private active membership", async () => {
    const firstRepositories = createRepositories();
    const secondRepositories = createRepositories();
    const creator = await createUser(firstRepositories, "초대자");
    const invitee = await createUser(firstRepositories, "초대받은 사용자");
    const { group } = await createGroup(firstRepositories, {
      actorId: creator.id,
      name: "동시 수락 그룹",
    });
    const invite = await issueInvite(firstRepositories, { groupId: group.id, issuerId: creator.id });

    const accepted = await Promise.all([
      acceptGroupInvite(firstRepositories, { actorId: invitee.id, groupId: group.id }),
      acceptGroupInvite(secondRepositories, { actorId: invitee.id, groupId: group.id }),
    ]);

    expect(accepted.map(({ alreadyMember }) => alreadyMember).sort()).toEqual([false, true]);
    const history = await membershipHistory(group.id, invitee.id);
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0]).toMatchObject({
      left_at: null,
      email_visibility: "PRIVATE",
    });
    await expect(getInvite(firstRepositories, invite.rawToken, invitee.id)).resolves.toMatchObject({
      alreadyMember: true,
      currentMemberCount: 2,
    });
  });

  it("ends membership, denies direct group access, and creates a new private history after rejoining", async () => {
    const repositories = createRepositories();
    const creator = await createUser(repositories, "생성자");
    const member = await createUser(repositories, "탈퇴 후 재가입 사용자");
    const { group } = await createGroup(repositories, { actorId: creator.id, name: "재가입 그룹" });
    const invite = await issueInvite(repositories, { groupId: group.id, issuerId: creator.id });
    const firstAcceptance = await acceptGroupInvite(repositories, {
      actorId: member.id,
      groupId: group.id,
    });
    await setGroupEmailVisibility(repositories, {
      actorId: member.id,
      groupId: group.id,
      emailVisibility: "PUBLIC",
    });

    const departed = await leaveGroup(repositories, {
      actorId: member.id,
      groupId: group.id,
      confirmation: true,
    });
    expect(departed.id).toBe(firstAcceptance.membership.id);
    expect(departed.leftAt).toBeInstanceOf(Date);
    await expect(getGroupDetail(group.id, member.id, repositories)).resolves.toBeNull();
    await expect(getGroups(member.id, repositories)).resolves.toEqual([]);
    await expect(
      issueInvite(repositories, { groupId: group.id, issuerId: member.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const rejoined = await acceptGroupInvite(repositories, {
      actorId: member.id,
      groupId: group.id,
    });
    expect(rejoined).toMatchObject({ alreadyMember: false });
    expect(rejoined.membership).toMatchObject({
      emailVisibility: "PRIVATE",
      leftAt: null,
    });
    expect(rejoined.membership.id).not.toBe(firstAcceptance.membership.id);

    const history = await membershipHistory(group.id, member.id);
    expect(history.rows).toHaveLength(2);
    expect(history.rows[0]).toMatchObject({
      id: firstAcceptance.membership.id,
      email_visibility: "PUBLIC",
    });
    expect(history.rows[0]?.left_at).toBeInstanceOf(Date);
    expect(history.rows[1]).toMatchObject({
      id: rejoined.membership.id,
      left_at: null,
      email_visibility: "PRIVATE",
    });
    await expect(getInvite(repositories, invite.rawToken, member.id)).resolves.toMatchObject({
      alreadyMember: true,
    });
  });

  it("updates only the selected membership row and withholds group detail from an outsider", async () => {
    const repositories = createRepositories();
    const member = await createUser(repositories, "두 그룹 구성원");
    const outsider = await createUser(repositories, "직접 URL 외부 사용자");
    const first = await createGroup(repositories, { actorId: member.id, name: "첫 번째 그룹" });
    const second = await createGroup(repositories, { actorId: member.id, name: "두 번째 그룹" });

    await setGroupEmailVisibility(repositories, {
      actorId: member.id,
      groupId: first.group.id,
      emailVisibility: "PUBLIC",
    });

    const memberships = await fixture.current.pool.query<{
      group_id: string;
      email_visibility: "PRIVATE" | "PUBLIC";
    }>(
      `SELECT "group_id", "email_visibility"
       FROM "memberships"
       WHERE "user_id" = $1 AND "left_at" IS NULL
       ORDER BY "group_id" ASC`,
      [member.id],
    );
    expect(memberships.rows).toEqual(
      expect.arrayContaining([
        { group_id: first.group.id, email_visibility: "PUBLIC" },
        { group_id: second.group.id, email_visibility: "PRIVATE" },
      ]),
    );

    await expect(getGroupDetail(first.group.id, outsider.id, repositories)).resolves.toBeNull();
    const detail = await getGroupDetail(first.group.id, member.id, repositories);
    expect(detail?.members).toContainEqual({
      userId: member.id,
      nickname: member.nickname,
      email: member.email,
    });
  });
});
