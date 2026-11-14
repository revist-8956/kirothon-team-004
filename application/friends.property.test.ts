import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";

import { addFriend, getFriends, type FriendListItem } from "./friends";
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

type FriendAdditionCommand =
  | { readonly kind: "registered"; readonly targetIndex: number }
  | { readonly kind: "self" }
  | { readonly kind: "unregistered" }
  | { readonly kind: "malformed" };

type ModelOutcome = "added" | "duplicate" | "self" | "unregistered" | "malformed";

interface FriendCommandModel {
  readonly ownerEmail: string;
  readonly registeredEmails: readonly string[];
  readonly friendEmails: Set<string>;
}

function applyToModel(model: FriendCommandModel, command: FriendAdditionCommand): ModelOutcome {
  switch (command.kind) {
    case "registered": {
      const targetEmail = model.registeredEmails[command.targetIndex];
      if (!targetEmail) {
        throw new Error("Registered friend command requires an available target");
      }
      if (model.friendEmails.has(targetEmail)) {
        return "duplicate";
      }
      model.friendEmails.add(targetEmail);
      return "added";
    }
    case "self":
      return "self";
    case "unregistered":
      return "unregistered";
    case "malformed":
      return "malformed";
  }
}

function commandInput(
  model: FriendCommandModel,
  command: FriendAdditionCommand,
  commandIndex: number,
): string {
  switch (command.kind) {
    case "registered":
      return model.registeredEmails[command.targetIndex] ?? "missing-target@example.test";
    case "self":
      return model.ownerEmail;
    case "unregistered":
      return `missing-${commandIndex}-${randomUUID()}@example.test`;
    case "malformed":
      return "not-an-email";
  }
}

async function expectModelOutcome(
  repositories: PrismaRepositoryUnitOfWork,
  ownerId: string,
  email: string,
  outcome: ModelOutcome,
): Promise<void> {
  const request = () => addFriend(repositories, ownerId, { email });

  switch (outcome) {
    case "added":
      await expect(request()).resolves.toMatchObject({ email });
      return;
    case "duplicate":
      await expect(request()).rejects.toMatchObject({ code: "CONFLICT" });
      return;
    case "self":
    case "malformed":
      await expect(request()).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      return;
    case "unregistered":
      await expect(request()).rejects.toMatchObject({ code: "NOT_FOUND" });
  }
}

function emailsOf(friends: readonly FriendListItem[]): string[] {
  return friends.map((friend) => friend.email);
}

const commandSequenceArbitrary = fc.array(
  fc.oneof(
    fc.integer({ min: 0, max: 3 }).map(
      (targetIndex): FriendAdditionCommand => ({ kind: "registered", targetIndex }),
    ),
    fc.constant<FriendAdditionCommand>({ kind: "self" }),
    fc.constant<FriendAdditionCommand>({ kind: "unregistered" }),
    fc.constant<FriendAdditionCommand>({ kind: "malformed" }),
  ),
  { maxLength: 30 },
);

describe("friend relationship command model", () => {
  // Feature: personal-group-notifications, Property 4: 친구 관계의 방향성과 고유성
  // **Validates: Requirements 2.2, 2.6, 2.7, 2.8**
  it("never adds the owner or duplicates, and preserves the existing set for invalid commands", async () => {
    const repositories = createRepositories();

    await fc.assert(
      fc.asyncProperty(commandSequenceArbitrary, async (commands) => {
        const suffix = randomUUID();
        const ownerEmail = `owner-${suffix}@example.test`;
        const owner = await createUser(repositories, ownerEmail, "소유자");
        const registeredEmails = Array.from(
          { length: 4 },
          (_, index) => `friend-${index}-${suffix}@example.test`,
        );

        await Promise.all(
          registeredEmails.map((email, index) =>
            createUser(repositories, email, `친구 ${index + 1}`),
          ),
        );

        const model: FriendCommandModel = {
          ownerEmail,
          registeredEmails,
          friendEmails: new Set(),
        };

        for (const [commandIndex, command] of commands.entries()) {
          const before = await getFriends(repositories, owner.id);
          const outcome = applyToModel(model, command);
          const email = commandInput(model, command, commandIndex);

          await expectModelOutcome(repositories, owner.id, email, outcome);

          const after = await getFriends(repositories, owner.id);
          const actualEmails = emailsOf(after);

          if (outcome !== "added") {
            expect(after).toEqual(before);
          }

          expect(new Set(actualEmails)).toEqual(model.friendEmails);
          expect(actualEmails).not.toContain(ownerEmail);
          expect(new Set(actualEmails).size).toBe(actualEmails.length);
        }
      }),
      { numRuns: 100 },
    );
  }, 120_000);
});
