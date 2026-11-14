import { createHash, randomBytes } from "node:crypto";

import { ApplicationError } from "./action-result";
import type { RepositoryUnitOfWork } from "./repositories";

const MINIMUM_INVITE_TOKEN_BYTES = 32;
const BASE64URL_TOKEN = /^[A-Za-z0-9_-]+$/;

export interface IssueInviteInput {
  readonly groupId: string;
  readonly issuerId: string;
}

export interface IssuedInvite {
  /** Kept only in the caller's response so it can be put in the invitation URL. */
  readonly rawToken: string;
  readonly groupId: string;
}

/**
 * The minimal data needed to render an invitation confirmation screen. No raw
 * token, email address, membership history, or other group-member data leaks
 * through this projection.
 */
export interface InviteProjection {
  readonly groupId: string;
  readonly groupName: string;
  readonly inviterNickname: string;
  readonly currentMemberCount: number;
  readonly alreadyMember: boolean;
  /** Safe origin-relative path to retain across the Google login round trip. */
  readonly returnTo: string;
}

/** Generates a URL-safe token with exactly 256 bits of cryptographic entropy. */
export function createRawInviteToken(): string {
  return randomBytes(MINIMUM_INVITE_TOKEN_BYTES).toString("base64url");
}

/** Returns the SHA-256 hex digest stored in PostgreSQL for a raw token. */
export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/**
 * Builds the only internal path used to resume an invite request after login.
 * A malformed raw token never becomes a redirect target.
 */
export function getInviteReturnTo(rawToken: string): string | null {
  return isRawInviteToken(rawToken) ? `/invite/${rawToken}` : null;
}

/**
 * Creates an invitation for a current group member. The membership check is
 * made inside the transaction and guarded by the group lock so a stale client
 * cannot issue an invite after leaving the group.
 */
export async function issueInvite(
  repositories: RepositoryUnitOfWork,
  input: IssueInviteInput,
): Promise<IssuedInvite> {
  const rawToken = createRawInviteToken();
  const tokenHash = hashInviteToken(rawToken);

  await repositories.transaction(async (transaction) => {
    await transaction.lockGroup(input.groupId);

    const currentMembership = await transaction.memberships.findCurrent(
      input.groupId,
      input.issuerId,
    );
    if (!currentMembership) {
      throw new ApplicationError("FORBIDDEN");
    }

    await transaction.invites.create({
      groupId: input.groupId,
      issuedById: input.issuerId,
      tokenHash,
    });
  });

  return { rawToken, groupId: input.groupId };
}

/**
 * Resolves a valid invitation to a display-safe confirmation projection. A
 * malformed token, unknown hash, or inconsistent related record is uniformly
 * represented as null so callers can render the generic invalid-invite state.
 */
export async function getInvite(
  repositories: RepositoryUnitOfWork,
  rawToken: string,
  viewerId?: string,
): Promise<InviteProjection | null> {
  const returnTo = getInviteReturnTo(rawToken);
  if (!returnTo) {
    return null;
  }

  const tokenHash = hashInviteToken(rawToken);

  return repositories.transaction(async (transaction) => {
    const invite = await transaction.invites.findByTokenHash(tokenHash);
    if (!invite) {
      return null;
    }

    const [group, inviter, memberships, viewerMembership] = await Promise.all([
      transaction.groups.findById(invite.groupId),
      transaction.users.findById(invite.issuedById),
      transaction.memberships.listCurrentForGroup(invite.groupId),
      viewerId
        ? transaction.memberships.findCurrent(invite.groupId, viewerId)
        : Promise.resolve(null),
    ]);

    if (!group || !inviter) {
      return null;
    }

    return {
      groupId: group.id,
      groupName: group.name,
      inviterNickname: inviter.nickname,
      currentMemberCount: memberships.length,
      alreadyMember: viewerMembership !== null,
      returnTo,
    };
  });
}

function isRawInviteToken(rawToken: string): boolean {
  if (!BASE64URL_TOKEN.test(rawToken)) {
    return false;
  }

  const decoded = Buffer.from(rawToken, "base64url");
  return (
    decoded.byteLength >= MINIMUM_INVITE_TOKEN_BYTES &&
    decoded.toString("base64url") === rawToken
  );
}
