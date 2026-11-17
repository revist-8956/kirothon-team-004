import { Prisma, PrismaClient, type EmailVisibility } from "@prisma/client";

import type {
  CreateClaimInput,
  CreateDispatchInput,
  CreateDispatchRecipientInput,
  CreateDraftInput,
  CreateGroupInput,
  CreateInviteInput,
  CreateMembershipInput,
  CreateNotificationInput,
  DueCandidateQuery,
  InboxCardRecord,
  InboxPageRecord,
  DispatchesRepository,
  EnsureUserProfileInput,
  DispatchRecipientRecord,
  DispatchRecord,
  FriendListItemRecord,
  FriendsRepository,
  GroupDetailRecord,
  GroupListItem,
  GroupMemberDetail,
  GroupsRepository,
  InviteRecord,
  InvitesRepository,
  MembershipRecord,
  MembershipsRepository,
  NotificationDraftRecord,
  NotificationDraftsRepository,
  NotificationRecord,
  NotificationsRepository,
  RepositoryTransaction,
  RepositoryUnitOfWork,
  ScheduleClaimRecord,
  ScheduleClaimsRepository,
  UserRecord,
  UsersRepository,
} from "../application/repositories";
import type { RecipientCandidate } from "../domain/recipients";
import { prisma } from "./db";

type PrismaDatabaseClient = PrismaClient | Prisma.TransactionClient;

export class PrismaUsersRepository implements UsersRepository {
  constructor(private readonly database: PrismaDatabaseClient) {}

  findById(id: string): Promise<UserRecord | null> {
    return this.database.user.findUnique({ where: { id } });
  }

  findByNormalizedEmail(emailNormalized: string): Promise<UserRecord | null> {
    return this.database.user.findUnique({ where: { emailNormalized } });
  }

  async ensureProfile(input: EnsureUserProfileInput): Promise<UserRecord | null> {
    // ON CONFLICT DO NOTHING: the Supabase trigger may already have created it.
    await this.database.user.createMany({ data: [input], skipDuplicates: true });
    return this.findById(input.id);
  }

  async updateNickname(
    id: string,
    nickname: string,
    nicknameRequired: boolean,
  ): Promise<UserRecord | null> {
    const result = await this.database.user.updateMany({
      where: { id },
      data: { nickname, nicknameRequired },
    });
    return result.count === 0 ? null : this.findById(id);
  }
}

export class PrismaFriendsRepository implements FriendsRepository {
  constructor(private readonly database: PrismaDatabaseClient) {}

  find(ownerId: string, friendId: string) {
    return this.database.friend.findUnique({ where: { ownerId_friendId: { ownerId, friendId } } });
  }

  create(ownerId: string, friendId: string) {
    return this.database.friend.create({ data: { ownerId, friendId } });
  }

  async listFriendIds(ownerId: string): Promise<readonly string[]> {
    const friends = await this.database.friend.findMany({
      where: { ownerId },
      select: { friendId: true },
    });
    return friends.map((friend) => friend.friendId);
  }

  async listForOwner(ownerId: string): Promise<readonly FriendListItemRecord[]> {
    return this.database.friend.findMany({
      where: { ownerId },
      select: {
        friend: {
          select: {
            nickname: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }).then((friends) => friends.map(({ friend }) => friend));
  }

  async listComposeOptions(ownerId: string) {
    return this.database.friend.findMany({
      where: { ownerId },
      select: {
        friend: {
          select: {
            id: true,
            nickname: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }).then((friends) => friends.map(({ friend }) => friend));
  }
}

export class PrismaGroupsRepository implements GroupsRepository {
  constructor(private readonly database: PrismaDatabaseClient) {}

  findById(id: string) {
    return this.database.group.findUnique({ where: { id } });
  }

  create(input: CreateGroupInput) {
    return this.database.group.create({ data: input });
  }

  /**
   * The viewer's active membership is part of the query predicate so that a
   * departed group cannot appear in a stale or directly requested list.
   */
  async listCurrentForUser(userId: string): Promise<readonly GroupListItem[]> {
    return this.database.$queryRaw<GroupListItem[]>`
      SELECT
        "groups"."id",
        "groups"."name",
        (
          SELECT COUNT(*)::integer
          FROM "memberships" AS "member_count"
          WHERE "member_count"."group_id" = "groups"."id"
            AND "member_count"."left_at" IS NULL
        ) AS "memberCount",
        (
          SELECT "dispatch"."sent_at"
          FROM "notification"
          INNER JOIN "dispatch"
            ON "dispatch"."notification_id" = "notification"."id"
          WHERE "notification"."group_id" = "groups"."id"
          ORDER BY "dispatch"."sent_at" DESC
          LIMIT 1
        ) AS "latestDispatchSentAt"
      FROM "memberships" AS "viewer_membership"
      INNER JOIN "groups"
        ON "groups"."id" = "viewer_membership"."group_id"
      WHERE "viewer_membership"."user_id" = ${userId}::uuid
        AND "viewer_membership"."left_at" IS NULL
      ORDER BY "groups"."created_at" ASC, "groups"."id" ASC
    `;
  }

  /**
   * Fetches all nicknames, but joins the email table a second time only for
   * PUBLIC memberships. The authorization predicate and data projection are
   * therefore enforced by the same database statement.
   */
  async findDetailForCurrentMember(
    groupId: string,
    userId: string,
  ): Promise<GroupDetailRecord | null> {
    const rows = await this.database.$queryRaw<GroupDetailRow[]>`
      SELECT
        "groups"."id",
        "groups"."name",
        "groups"."created_by_id" AS "createdById",
        "groups"."created_at" AS "createdAt",
        "viewer_membership"."email_visibility" AS "emailVisibility",
        "member_membership"."user_id" AS "userId",
        "member_user"."nickname",
        "public_member_user"."email"
      FROM "memberships" AS "viewer_membership"
      INNER JOIN "groups"
        ON "groups"."id" = "viewer_membership"."group_id"
      INNER JOIN "memberships" AS "member_membership"
        ON "member_membership"."group_id" = "groups"."id"
        AND "member_membership"."left_at" IS NULL
      INNER JOIN "users" AS "member_user"
        ON "member_user"."id" = "member_membership"."user_id"
      LEFT JOIN "users" AS "public_member_user"
        ON "public_member_user"."id" = "member_membership"."user_id"
        AND "member_membership"."email_visibility" = 'PUBLIC'::"email_visibility"
      WHERE "viewer_membership"."group_id" = ${groupId}::uuid
        AND "viewer_membership"."user_id" = ${userId}::uuid
        AND "viewer_membership"."left_at" IS NULL
      ORDER BY "member_membership"."joined_at" ASC, "member_membership"."user_id" ASC
    `;

    const first = rows[0];
    if (!first) {
      return null;
    }

    const members: GroupMemberDetail[] = rows.map((row) => ({
      userId: row.userId,
      nickname: row.nickname,
      ...(row.email === null ? {} : { email: row.email }),
    }));

    return {
      id: first.id,
      name: first.name,
      createdById: first.createdById,
      createdAt: first.createdAt,
      emailVisibility: first.emailVisibility,
      members,
    };
  }
}

interface GroupDetailRow {
  readonly id: string;
  readonly name: string;
  readonly createdById: string;
  readonly createdAt: Date;
  readonly emailVisibility: EmailVisibility;
  readonly userId: string;
  readonly nickname: string;
  readonly email: string | null;
}

export class PrismaMembershipsRepository implements MembershipsRepository {
  constructor(private readonly database: PrismaDatabaseClient) {}

  findCurrent(groupId: string, userId: string) {
    return this.database.membership.findFirst({
      where: { groupId, userId, leftAt: null },
      orderBy: { joinedAt: "desc" },
    });
  }

  listCurrentForGroup(groupId: string) {
    return this.database.membership.findMany({
      where: { groupId, leftAt: null },
      orderBy: { joinedAt: "asc" },
    });
  }

  async listCurrentMemberProfiles(groupId: string): Promise<readonly RecipientCandidate[]> {
    const memberships = await this.database.membership.findMany({
      where: { groupId, leftAt: null },
      orderBy: { joinedAt: "asc" },
      select: { userId: true, user: { select: { nickname: true } } },
    });
    return memberships.map((membership) => ({
      userId: membership.userId,
      nickname: membership.user.nickname,
    }));
  }

  create(input: CreateMembershipInput) {
    return this.database.membership.create({ data: input });
  }

  async leaveCurrent(groupId: string, userId: string): Promise<MembershipRecord | null> {
    const rows = await this.database.$queryRaw<MembershipRecord[]>`
      UPDATE "memberships"
      SET "left_at" = transaction_timestamp()
      WHERE "group_id" = ${groupId}::uuid
        AND "user_id" = ${userId}::uuid
        AND "left_at" IS NULL
      RETURNING
        "id",
        "group_id" AS "groupId",
        "user_id" AS "userId",
        "joined_at" AS "joinedAt",
        "left_at" AS "leftAt",
        "email_visibility" AS "emailVisibility",
        "created_at" AS "createdAt"
    `;
    return rows[0] ?? null;
  }

  async updateCurrentVisibility(
    groupId: string,
    userId: string,
    emailVisibility: EmailVisibility,
  ): Promise<MembershipRecord | null> {
    const rows = await this.database.$queryRaw<MembershipRecord[]>`
      UPDATE "memberships"
      SET "email_visibility" = ${emailVisibility}::"email_visibility"
      WHERE "group_id" = ${groupId}::uuid
        AND "user_id" = ${userId}::uuid
        AND "left_at" IS NULL
      RETURNING
        "id",
        "group_id" AS "groupId",
        "user_id" AS "userId",
        "joined_at" AS "joinedAt",
        "left_at" AS "leftAt",
        "email_visibility" AS "emailVisibility",
        "created_at" AS "createdAt"
    `;
    return rows[0] ?? null;
  }
}

export class PrismaInvitesRepository implements InvitesRepository {
  constructor(private readonly database: PrismaDatabaseClient) {}

  findByTokenHash(tokenHash: string): Promise<InviteRecord | null> {
    return this.database.invite.findUnique({ where: { tokenHash } });
  }

  create(input: CreateInviteInput): Promise<InviteRecord> {
    return this.database.invite.create({ data: input });
  }
}

export class PrismaNotificationsRepository implements NotificationsRepository {
  constructor(private readonly database: PrismaDatabaseClient) {}

  findById(id: string): Promise<NotificationRecord | null> {
    return this.database.notification.findUnique({ where: { id } });
  }

  create(input: CreateNotificationInput): Promise<NotificationRecord> {
    return this.database.notification.create({ data: input });
  }

  async createPersonalTargets(notificationId: string, userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) {
      return;
    }
    await this.database.personalTarget.createMany({
      data: userIds.map((userId) => ({ notificationId, userId })),
      skipDuplicates: true,
    });
  }

  listDueCandidates(input: DueCandidateQuery): Promise<readonly NotificationRecord[]> {
    return this.database.notification.findMany({
      where: {
        OR: [
          {
            scheduleKind: "ONE_TIME",
            oneTimeAt: { gt: input.fromExclusive, lte: input.throughInclusive },
            scheduleClaims: { none: {} },
          },
          {
            scheduleKind: "RECURRING",
            startDate: { lte: input.throughKstDate },
            OR: [{ state: "ACTIVE" }, { stoppedAt: { gt: input.fromExclusive } }],
          },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  async listPersonalTargetProfiles(notificationId: string): Promise<readonly RecipientCandidate[]> {
    const targets = await this.database.personalTarget.findMany({
      where: { notificationId },
      orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
      select: { userId: true, user: { select: { nickname: true } } },
    });
    return targets.map((target) => ({ userId: target.userId, nickname: target.user.nickname }));
  }

  async stopRecurring(notificationId: string, senderId: string): Promise<NotificationRecord | null> {
    const rows = await this.database.$queryRaw<NotificationRecord[]>`
      UPDATE "notification"
      SET "state" = 'STOPPED'::"NotificationState",
          "stopped_at" = transaction_timestamp()
      WHERE "id" = ${notificationId}::uuid
        AND "sender_id" = ${senderId}::uuid
        AND "schedule_kind" = 'RECURRING'::"ScheduleKind"
        AND "state" = 'ACTIVE'::"NotificationState"
      RETURNING
        "id", "sender_id" AS "senderId", "sentence", "mode", "group_id" AS "groupId",
        "schedule_kind" AS "scheduleKind", "one_time_at" AS "oneTimeAt", "recurrence",
        "start_date" AS "startDate", "weekday", "day_of_month" AS "dayOfMonth",
        "local_time" AS "localTime", "skip_weekend" AS "skipWeekend", "timezone",
        "state", "stopped_at" AS "stoppedAt", "created_at" AS "createdAt"
    `;
    return rows[0] ?? null;
  }
}

export class PrismaNotificationDraftsRepository implements NotificationDraftsRepository {
  constructor(private readonly database: PrismaDatabaseClient) {}

  findById(id: string): Promise<NotificationDraftRecord | null> {
    return this.database.notificationDraft.findUnique({ where: { id } });
  }

  create(input: CreateDraftInput): Promise<NotificationDraftRecord> {
    return this.database.notificationDraft.create({ data: input });
  }

  async consumeAvailable(id: string, ownerId: string): Promise<NotificationDraftRecord | null> {
    const rows = await this.database.$queryRaw<NotificationDraftRecord[]>`
      UPDATE "notification_draft"
      SET "consumed_at" = transaction_timestamp()
      WHERE "id" = ${id}::uuid
        AND "owner_id" = ${ownerId}::uuid
        AND "consumed_at" IS NULL
        AND "expires_at" > transaction_timestamp()
      RETURNING
        "id", "owner_id" AS "ownerId", "sentence", "mode", "target_json" AS "targetJson",
        "expires_at" AS "expiresAt", "consumed_at" AS "consumedAt", "created_at" AS "createdAt"
    `;
    return rows[0] ?? null;
  }
}

export class PrismaScheduleClaimsRepository implements ScheduleClaimsRepository {
  constructor(private readonly database: PrismaDatabaseClient) {}

  find(notificationId: string, effectiveDate: Date): Promise<ScheduleClaimRecord | null> {
    return this.database.scheduleClaim.findUnique({
      where: { notificationId_effectiveDate: { notificationId, effectiveDate } },
    });
  }

  listClaimedDates(
    notificationIds: readonly string[],
    fromDate: Date,
  ): Promise<ReadonlyArray<{ readonly notificationId: string; readonly effectiveDate: Date }>> {
    if (notificationIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.database.scheduleClaim.findMany({
      where: { notificationId: { in: [...notificationIds] }, effectiveDate: { gte: fromDate } },
      select: { notificationId: true, effectiveDate: true },
    });
  }

  create(input: CreateClaimInput): Promise<ScheduleClaimRecord> {
    return this.database.scheduleClaim.create({ data: { ...input, sourceDates: [...input.sourceDates] } });
  }
}

export class PrismaDispatchesRepository implements DispatchesRepository {
  constructor(private readonly database: PrismaDatabaseClient) {}

  findById(id: string): Promise<DispatchRecord | null> {
    return this.database.dispatch.findUnique({ where: { id } });
  }

  create(input: CreateDispatchInput): Promise<DispatchRecord> {
    return this.database.dispatch.create({ data: input });
  }

  async nextSequence(notificationId: string): Promise<number> {
    const result = await this.database.dispatch.aggregate({
      where: { notificationId },
      _max: { sequence: true },
    });
    return (result._max.sequence ?? 0) + 1;
  }

  async createRecipients(
    dispatchId: string,
    recipients: readonly CreateDispatchRecipientInput[],
  ): Promise<void> {
    if (recipients.length === 0) {
      return;
    }
    await this.database.dispatchRecipient.createMany({
      data: recipients.map((recipient) => ({ dispatchId, ...recipient })),
      skipDuplicates: true,
    });
  }

  findRecipient(dispatchId: string, recipientId: string): Promise<DispatchRecipientRecord | null> {
    return this.database.dispatchRecipient.findUnique({
      where: { dispatchId_recipientId: { dispatchId, recipientId } },
    });
  }

  async listInboxForRecipient(recipientId: string, limit: number): Promise<InboxPageRecord> {
    const rows = await this.database.$queryRaw<Array<InboxCardRecord & { unconfirmedCount: bigint }>>`
      SELECT
        r."dispatch_id" AS "dispatchId", n."id" AS "notificationId", n."sentence",
        n."mode", g."name" AS "groupName", s."nickname" AS "senderNickname",
        n."schedule_kind" AS "scheduleKind", n."recurrence", d."sequence",
        d."sent_at" AS "sentAt", r."confirmed_at" AS "confirmedAt",
        COUNT(*) FILTER (WHERE r."confirmed_at" IS NULL) OVER () AS "unconfirmedCount"
      FROM "dispatch_recipient" r
      JOIN "dispatch" d ON d."id" = r."dispatch_id"
      JOIN "notification" n ON n."id" = d."notification_id"
      JOIN "users" s ON s."id" = n."sender_id"
      LEFT JOIN "groups" g ON g."id" = n."group_id"
      WHERE r."recipient_id" = ${recipientId}::uuid
        AND (
          n."mode" = 'PERSONAL'::"DeliveryMode"
          OR EXISTS (
            SELECT 1
            FROM "memberships" m
            WHERE m."group_id" = n."group_id"
              AND m."user_id" = r."recipient_id"
              AND m."left_at" IS NULL
              AND m."joined_at" <= d."sent_at"
          )
        )
      ORDER BY d."sent_at" DESC, d."id" DESC
      LIMIT ${limit}
    `;
    return {
      cards: rows.map((row) => ({
        dispatchId: row.dispatchId,
        notificationId: row.notificationId,
        sentence: row.sentence,
        mode: row.mode,
        groupName: row.groupName,
        senderNickname: row.senderNickname,
        scheduleKind: row.scheduleKind,
        recurrence: row.recurrence,
        sequence: row.sequence,
        sentAt: row.sentAt,
        confirmedAt: row.confirmedAt,
      })),
      unconfirmedCount: Number(rows[0]?.unconfirmedCount ?? 0),
    };
  }

  async confirmRecipient(
    dispatchId: string,
    recipientId: string,
  ): Promise<DispatchRecipientRecord | null> {
    const rows = await this.database.$queryRaw<DispatchRecipientRecord[]>`
      UPDATE "dispatch_recipient"
      SET "confirmed_at" = transaction_timestamp()
      WHERE "dispatch_id" = ${dispatchId}::uuid
        AND "recipient_id" = ${recipientId}::uuid
        AND "confirmed_at" IS NULL
      RETURNING
        "id", "dispatch_id" AS "dispatchId", "recipient_id" AS "recipientId",
        "recipient_nickname_snapshot" AS "recipientNicknameSnapshot",
        "confirmed_at" AS "confirmedAt", "created_at" AS "createdAt"
    `;
    return rows[0] ?? null;
  }
}

class PrismaRepositoryTransaction implements RepositoryTransaction {
  readonly users: UsersRepository;
  readonly friends: FriendsRepository;
  readonly groups: GroupsRepository;
  readonly memberships: MembershipsRepository;
  readonly invites: InvitesRepository;
  readonly notifications: NotificationsRepository;
  readonly drafts: NotificationDraftsRepository;
  readonly claims: ScheduleClaimsRepository;
  readonly dispatches: DispatchesRepository;

  constructor(private readonly database: Prisma.TransactionClient) {
    this.users = new PrismaUsersRepository(database);
    this.friends = new PrismaFriendsRepository(database);
    this.groups = new PrismaGroupsRepository(database);
    this.memberships = new PrismaMembershipsRepository(database);
    this.invites = new PrismaInvitesRepository(database);
    this.notifications = new PrismaNotificationsRepository(database);
    this.drafts = new PrismaNotificationDraftsRepository(database);
    this.claims = new PrismaScheduleClaimsRepository(database);
    this.dispatches = new PrismaDispatchesRepository(database);
  }

  async lockGroup(groupId: string): Promise<void> {
    await this.database.$queryRaw<Array<{ locked: number }>>`
      SELECT 1 AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${groupId}::text, 0))
    `;
  }

  async tryLockNotification(notificationId: string): Promise<boolean> {
    // A separate key namespace from lockGroup, so a notification and a group never share a lock.
    const rows = await this.database.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${`notification:${notificationId}`}::text, 0)) AS "locked"
    `;
    return rows[0]?.locked === true;
  }

  now(): Promise<Date> {
    return readDatabaseTimestamp(this.database, Prisma.sql`now()`);
  }

  transactionTimestamp(): Promise<Date> {
    return readDatabaseTimestamp(this.database, Prisma.sql`transaction_timestamp()`);
  }
}

async function readDatabaseTimestamp(
  database: Prisma.TransactionClient,
  expression: Prisma.Sql,
): Promise<Date> {
  const rows = await database.$queryRaw<Array<{ value: Date }>>(
    Prisma.sql`SELECT ${expression} AS "value"`,
  );
  const value = rows[0]?.value;
  if (!value) {
    throw new Error("The database did not return a timestamp");
  }
  return value;
}

export class PrismaRepositoryUnitOfWork implements RepositoryUnitOfWork {
  constructor(private readonly database: PrismaClient = prisma) {}

  transaction<T>(work: (repositories: RepositoryTransaction) => Promise<T>): Promise<T> {
    return this.database.$transaction((transaction) => work(new PrismaRepositoryTransaction(transaction)));
  }
}

export const repositories = new PrismaRepositoryUnitOfWork();
