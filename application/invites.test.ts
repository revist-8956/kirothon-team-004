import { createHash } from "node:crypto";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  createRawInviteToken,
  getInviteReturnTo,
  hashInviteToken,
  issueInvite,
} from "./invites";
import type {
  CreateInviteInput,
  MembershipRecord,
  RepositoryTransaction,
  RepositoryUnitOfWork,
} from "./repositories";

const TEST_TIME = new Date("2026-02-03T04:05:06.000Z");

type IssuerMembershipState = "ACTIVE" | "LEFT" | "ABSENT";

interface InvitationPolicyScenario {
  readonly issuerId: string;
  readonly groupId: string;
  readonly issuerMembershipState: IssuerMembershipState;
  readonly memberships: readonly MembershipRecord[];
}

function createMembership(
  id: string,
  groupId: string,
  userId: string,
  active: boolean,
): MembershipRecord {
  return {
    id,
    groupId,
    userId,
    joinedAt: TEST_TIME,
    leftAt: active ? null : TEST_TIME,
    emailVisibility: "PRIVATE",
    createdAt: TEST_TIME,
  };
}

const invitationPolicyScenarioArbitrary: fc.Arbitrary<InvitationPolicyScenario> = fc
  .record({
    issuerToken: fc.string(),
    groupToken: fc.string(),
    issuerMembershipState: fc.constantFrom<IssuerMembershipState>("ACTIVE", "LEFT", "ABSENT"),
    otherMemberships: fc.array(
      fc.record({
        userToken: fc.string(),
        groupToken: fc.string(),
        active: fc.boolean(),
      }),
      { maxLength: 20 },
    ),
  })
  .map(({ issuerToken, groupToken, issuerMembershipState, otherMemberships }) => {
    const issuerId = `issuer:${issuerToken}`;
    const groupId = `group:${groupToken}`;
    const issuerMembership =
      issuerMembershipState === "ABSENT"
        ? []
        : [
            createMembership(
              "issuer-membership",
              groupId,
              issuerId,
              issuerMembershipState === "ACTIVE",
            ),
          ];
    const unrelatedMemberships = otherMemberships.map((membership, index) =>
      createMembership(
        `other-membership:${index}`,
        `other-group:${index}:${membership.groupToken}`,
        `other-user:${index}:${membership.userToken}`,
        membership.active,
      ),
    );

    return {
      issuerId,
      groupId,
      issuerMembershipState,
      memberships: [...issuerMembership, ...unrelatedMemberships],
    };
  });

function createInvitationPolicyFixture(memberships: readonly MembershipRecord[]) {
  const locks: string[] = [];
  const invitations: CreateInviteInput[] = [];
  const transaction = {
    lockGroup: async (groupId: string) => {
      locks.push(groupId);
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
    invites: {
      create: async (input: CreateInviteInput) => {
        invitations.push(input);
        return {
          id: `invite:${invitations.length}`,
          ...input,
          createdAt: TEST_TIME,
        };
      },
    },
  } as unknown as RepositoryTransaction;
  const repositories: RepositoryUnitOfWork = {
    transaction: async <T>(work: (current: RepositoryTransaction) => Promise<T>): Promise<T> =>
      work(transaction),
  };

  return { repositories, locks, invitations };
}

describe("invite token helpers", () => {
  it("creates a URL-safe token with 256 bits of entropy and hashes it with SHA-256", () => {
    const rawToken = createRawInviteToken();

    expect(rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(rawToken, "base64url")).toHaveLength(32);
    expect(getInviteReturnTo(rawToken)).toBe(`/invite/${rawToken}`);
    expect(hashInviteToken(rawToken)).toBe(
      createHash("sha256").update(rawToken, "utf8").digest("hex"),
    );
  });

  it.each([
    "",
    "not a token",
    "short-token",
    "a".repeat(42),
    "a".repeat(43) + "=",
  ])("does not build a login return path for malformed token %j", (rawToken) => {
    expect(getInviteReturnTo(rawToken)).toBeNull();
  });
});

describe("Property 7: invitation issuance authorization", () => {
  // Validates: Requirements 3.8
  it("permits invitation issuance if and only if the issuer has a current active membership", async () => {
    await fc.assert(
      fc.asyncProperty(invitationPolicyScenarioArbitrary, async (scenario) => {
        const { repositories, locks, invitations } = createInvitationPolicyFixture(scenario.memberships);
        const issue = () =>
          issueInvite(repositories, {
            groupId: scenario.groupId,
            issuerId: scenario.issuerId,
          });

        if (scenario.issuerMembershipState === "ACTIVE") {
          await expect(issue()).resolves.toMatchObject({ groupId: scenario.groupId });
          expect(invitations).toHaveLength(1);
        } else {
          await expect(issue()).rejects.toMatchObject({ code: "FORBIDDEN" });
          expect(invitations).toHaveLength(0);
        }

        expect(locks).toEqual([scenario.groupId]);
      }),
    );
  });
});
