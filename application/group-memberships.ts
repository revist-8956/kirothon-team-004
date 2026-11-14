import { z } from "zod";

import { ApplicationError } from "./action-result";
import type {
  GroupRecord,
  MembershipRecord,
  RepositoryTransaction,
  RepositoryUnitOfWork,
} from "./repositories";
import { groupNameSchema } from "../domain/content";

const identifierSchema = z.uuid();
const visibilitySchema = z.enum(["PRIVATE", "PUBLIC"]);

export interface CreateGroupCommand {
  /** Must be derived from the authenticated server session, never client input. */
  readonly actorId: string;
  readonly name: string;
}

export interface AcceptGroupInviteCommand {
  /** Must be derived from the authenticated server session, never client input. */
  readonly actorId: string;
  /** The invite flow resolves and validates the raw invite token before calling this command. */
  readonly groupId: string;
}

export interface LeaveGroupCommand {
  /** Must be derived from the authenticated server session, never client input. */
  readonly actorId: string;
  readonly groupId: string;
  /** The server action must only set this after the user explicitly confirms leaving. */
  readonly confirmation: boolean;
}

export interface SetGroupEmailVisibilityCommand {
  /** Must be derived from the authenticated server session, never client input. */
  readonly actorId: string;
  readonly groupId: string;
  readonly emailVisibility: "PRIVATE" | "PUBLIC";
}

export interface CreatedGroupMembership {
  readonly group: GroupRecord;
  readonly membership: MembershipRecord;
}

export interface AcceptedGroupInvite {
  readonly membership: MembershipRecord;
  /** True when the user was already a current member and no membership row changed. */
  readonly alreadyMember: boolean;
}

/**
 * Creates the group and its creator membership in one transaction. The creator
 * always starts with a private email setting and a database transaction timestamp.
 */
export async function createGroup(
  repositories: RepositoryUnitOfWork,
  command: CreateGroupCommand,
): Promise<CreatedGroupMembership> {
  const actorId = parseIdentifier(command.actorId, "actorId");
  const name = parseGroupName(command.name);

  return repositories.transaction(async (transaction) => {
    await requireExistingActor(transaction, actorId);
    const joinedAt = await transaction.transactionTimestamp();
    const group = await transaction.groups.create({ name, createdById: actorId });
    const membership = await transaction.memberships.create({
      groupId: group.id,
      userId: actorId,
      joinedAt,
      emailVisibility: "PRIVATE",
    });

    return { group, membership };
  });
}

/**
 * Records a new membership history row for a first acceptance or re-acceptance.
 * A current member is returned unchanged so acceptance is idempotent.
 */
export async function acceptGroupInvite(
  repositories: RepositoryUnitOfWork,
  command: AcceptGroupInviteCommand,
): Promise<AcceptedGroupInvite> {
  const actorId = parseIdentifier(command.actorId, "actorId");
  const groupId = parseIdentifier(command.groupId, "groupId");

  return repositories.transaction(async (transaction) => {
    await requireExistingActor(transaction, actorId);
    // This lock also serializes acceptance with departure and dispatch snapshots.
    await transaction.lockGroup(groupId);
    await requireExistingGroup(transaction, groupId);

    const currentMembership = await transaction.memberships.findCurrent(groupId, actorId);
    if (currentMembership) {
      return { membership: currentMembership, alreadyMember: true };
    }

    const joinedAt = await transaction.transactionTimestamp();
    const membership = await transaction.memberships.create({
      groupId,
      userId: actorId,
      joinedAt,
      emailVisibility: "PRIVATE",
    });
    return { membership, alreadyMember: false };
  });
}

/**
 * Ends only an active membership after explicit confirmation. The group-scoped
 * transaction lock keeps departure ordered with recipient snapshot operations.
 */
export async function leaveGroup(
  repositories: RepositoryUnitOfWork,
  command: LeaveGroupCommand,
): Promise<MembershipRecord> {
  const actorId = parseIdentifier(command.actorId, "actorId");
  const groupId = parseIdentifier(command.groupId, "groupId");
  if (command.confirmation !== true) {
    throw new ApplicationError("VALIDATION_ERROR", {
      message: "그룹 탈퇴를 확인해 주세요.",
      fieldErrors: { confirmation: ["그룹 탈퇴를 확인해 주세요."] },
    });
  }

  return repositories.transaction(async (transaction) => {
    await requireExistingActor(transaction, actorId);
    await transaction.lockGroup(groupId);
    const membership = await transaction.memberships.leaveCurrent(groupId, actorId);
    if (!membership) {
      throw new ApplicationError("FORBIDDEN");
    }
    return membership;
  });
}

/** Changes only the caller's active membership row in the selected group. */
export async function setGroupEmailVisibility(
  repositories: RepositoryUnitOfWork,
  command: SetGroupEmailVisibilityCommand,
): Promise<MembershipRecord> {
  const actorId = parseIdentifier(command.actorId, "actorId");
  const groupId = parseIdentifier(command.groupId, "groupId");
  const emailVisibility = visibilitySchema.parse(command.emailVisibility);

  return repositories.transaction(async (transaction) => {
    await requireExistingActor(transaction, actorId);
    const membership = await transaction.memberships.updateCurrentVisibility(
      groupId,
      actorId,
      emailVisibility,
    );
    if (!membership) {
      throw new ApplicationError("FORBIDDEN");
    }
    return membership;
  });
}

function parseIdentifier(value: string, field: "actorId" | "groupId"): string {
  const result = identifierSchema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  throw new ApplicationError("VALIDATION_ERROR", {
    fieldErrors: { [field]: ["올바른 식별자가 아닙니다."] },
  });
}

function parseGroupName(value: string): string {
  const result = groupNameSchema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  throw new ApplicationError("VALIDATION_ERROR", {
    message: "그룹 이름을 입력해 주세요.",
    fieldErrors: { name: ["그룹 이름을 입력해 주세요."] },
  });
}

async function requireExistingActor(
  transaction: RepositoryTransaction,
  actorId: string,
): Promise<void> {
  if (!(await transaction.users.findById(actorId))) {
    throw new ApplicationError("UNAUTHENTICATED");
  }
}

async function requireExistingGroup(
  transaction: RepositoryTransaction,
  groupId: string,
): Promise<void> {
  if (!(await transaction.groups.findById(groupId))) {
    throw new ApplicationError("NOT_FOUND");
  }
}
