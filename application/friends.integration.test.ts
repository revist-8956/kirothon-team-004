import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { ApplicationError } from "./action-result";
import { addFriend, getFriends } from "./friends";
import { PrismaRepositoryUnitOfWork } from "../infrastructure/prisma-repositories";
import { registerIsolatedPostgres } from "../tests/database/postgres-test-database";

const fixture = registerIsolatedPostgres();
const clients: PrismaClient[] = [];

function createRepositories(): PrismaRepositoryUnitOfWork {
  const client = new PrismaClient({ datasources: { db: { url: fixture.current.url } } });
  clients.push(client);
  return new PrismaRepositoryUnitOfWork(client);
}

async function createUser(
  repositories: PrismaRepositoryUnitOfWork,
  email: string,
  nickname: string,
) {
  return repositories.transaction((transaction) =>
    transaction.users.create({
      email,
      emailNormalized: email.toLowerCase(),
      nickname,
      nicknameRequired: false,
    }),
  );
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
});

describe("friend commands and queries", () => {
  it("adds a normalized registered address directionally and projects only nickname and email", async () => {
    const repositories = createRepositories();
    const suffix = randomUUID();
    const owner = await createUser(repositories, `owner-${suffix}@example.test`, "소유자");
    const friend = await createUser(repositories, `friend-${suffix}@example.test`, "친구");

    await expect(
      addFriend(repositories, owner.id, { email: `  FRIEND-${suffix.toUpperCase()}@EXAMPLE.TEST  ` }),
    ).resolves.toEqual({ nickname: "친구", email: friend.email });

    await expect(getFriends(repositories, owner.id)).resolves.toEqual([
      { nickname: "친구", email: friend.email },
    ]);
    await expect(getFriends(repositories, friend.id)).resolves.toEqual([]);
  });

  it("rejects malformed, unregistered, self, and duplicate addresses without adding a friendship", async () => {
    const repositories = createRepositories();
    const suffix = randomUUID();
    const owner = await createUser(repositories, `owner-${suffix}@example.test`, "소유자");
    const friend = await createUser(repositories, `friend-${suffix}@example.test`, "친구");

    await expect(addFriend(repositories, owner.id, { email: "not-an-email" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: { email: ["유효한 이메일 주소를 입력해 주세요."] },
    } satisfies Partial<ApplicationError>);
    await expect(
      addFriend(repositories, owner.id, { email: `missing-${suffix}@example.test` }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "사용자를 찾을 수 없어요." });
    await expect(addFriend(repositories, owner.id, { email: owner.email })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "본인은 친구로 추가할 수 없어요.",
    });

    await addFriend(repositories, owner.id, { email: friend.email });
    await expect(addFriend(repositories, owner.id, { email: friend.email })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "이미 친구예요.",
    });
    await expect(getFriends(repositories, owner.id)).resolves.toEqual([
      { nickname: "친구", email: friend.email },
    ]);
  });

  it("preserves one directional friendship when identical requests race", async () => {
    const repositories = createRepositories();
    const suffix = randomUUID();
    const owner = await createUser(repositories, `owner-${suffix}@example.test`, "소유자");
    const friend = await createUser(repositories, `friend-${suffix}@example.test`, "친구");

    const results = await Promise.allSettled([
      addFriend(repositories, owner.id, { email: friend.email }),
      addFriend(repositories, owner.id, { email: friend.email }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({ code: "CONFLICT", message: "이미 친구예요." });
    await expect(getFriends(repositories, owner.id)).resolves.toEqual([
      { nickname: "친구", email: friend.email },
    ]);
  });
});
