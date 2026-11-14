import type {
  ClaimState,
  DeliveryMode,
  EmailVisibility,
  NotificationState,
  Prisma,
  Recurrence,
  ScheduleKind,
  SkipReason,
} from "@prisma/client";

/**
 * Typed persistence boundary used by application commands and queries.
 * Implementations own Prisma and SQL details; application code receives only
 * these records and operations.
 */
export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly emailNormalized: string;
  readonly nickname: string;
  readonly nicknameRequired: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface FriendRecord {
  readonly ownerId: string;
  readonly friendId: string;
  readonly createdAt: Date;
}

/** The only fields exposed by the friends-list query. */
export interface FriendListItemRecord {
  readonly nickname: string;
  readonly email: string;
}

/** Minimal friend data required to render a personal-recipient selector. */
export interface ComposeFriendOptionRecord extends FriendListItemRecord {
  readonly id: string;
}

export interface GroupRecord {
  readonly id: string;
  readonly name: string;
  readonly createdById: string;
  readonly createdAt: Date;
}

/** Summary shown only for groups where the requester is currently a member. */
export interface GroupListItem {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly latestDispatchSentAt: Date | null;
}

/**
 * A current member's display data. Email is deliberately absent for members
 * whose membership visibility is PRIVATE.
 */
export interface GroupMemberDetail {
  readonly userId: string;
  readonly nickname: string;
  readonly email?: string;
}

/** Full group projection available only to a current group member. */
export interface GroupDetailRecord extends GroupRecord {
  readonly emailVisibility: EmailVisibility;
  readonly members: readonly GroupMemberDetail[];
}

export interface MembershipRecord {
  readonly id: string;
  readonly groupId: string;
  readonly userId: string;
  readonly joinedAt: Date;
  readonly leftAt: Date | null;
  readonly emailVisibility: EmailVisibility;
  readonly createdAt: Date;
}

export interface InviteRecord {
  readonly id: string;
  readonly groupId: string;
  readonly issuedById: string;
  /** SHA-256 hex digest only. Raw invitation tokens are never persisted. */
  readonly tokenHash: string;
  readonly createdAt: Date;
}

export interface NotificationRecord {
  readonly id: string;
  readonly senderId: string;
  readonly sentence: string;
  readonly mode: DeliveryMode;
  readonly groupId: string | null;
  readonly scheduleKind: ScheduleKind;
  readonly oneTimeAt: Date | null;
  readonly recurrence: Recurrence | null;
  readonly startDate: Date | null;
  readonly weekday: number | null;
  readonly dayOfMonth: number | null;
  readonly localTime: Date | null;
  readonly skipWeekend: boolean;
  readonly timezone: string;
  readonly state: NotificationState;
  readonly stoppedAt: Date | null;
  readonly createdAt: Date;
}

export interface NotificationDraftRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly sentence: string;
  readonly mode: DeliveryMode;
  readonly targetJson: Prisma.JsonValue;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly createdAt: Date;
}

export interface ScheduleClaimRecord {
  readonly id: string;
  readonly notificationId: string;
  readonly effectiveDate: Date;
  readonly sourceDates: readonly Date[];
  readonly state: ClaimState;
  readonly skipReason: SkipReason | null;
  readonly createdAt: Date;
}

export interface DispatchRecord {
  readonly id: string;
  readonly notificationId: string;
  readonly claimId: string;
  readonly sequence: number;
  readonly scheduledDate: Date;
  readonly effectiveDate: Date;
  readonly sentAt: Date;
  readonly createdAt: Date;
}

export interface DispatchRecipientRecord {
  readonly id: string;
  readonly dispatchId: string;
  readonly recipientId: string;
  readonly recipientNicknameSnapshot: string;
  readonly confirmedAt: Date | null;
  readonly createdAt: Date;
}

export interface CreateUserInput {
  readonly email: string;
  readonly emailNormalized: string;
  readonly nickname: string;
  readonly nicknameRequired: boolean;
  readonly name?: string | null;
  readonly image?: string | null;
  readonly emailVerified?: Date | null;
}

export interface CreateGroupInput {
  readonly name: string;
  readonly createdById: string;
}

export interface CreateMembershipInput {
  readonly groupId: string;
  readonly userId: string;
  readonly joinedAt?: Date;
  readonly emailVisibility?: EmailVisibility;
}

export interface CreateInviteInput {
  readonly groupId: string;
  readonly issuedById: string;
  /** SHA-256 hex digest only. */
  readonly tokenHash: string;
}

export interface CreateNotificationInput {
  readonly senderId: string;
  readonly sentence: string;
  readonly mode: DeliveryMode;
  readonly groupId?: string | null;
  readonly scheduleKind: ScheduleKind;
  readonly oneTimeAt?: Date | null;
  readonly recurrence?: Recurrence | null;
  readonly startDate?: Date | null;
  readonly weekday?: number | null;
  readonly dayOfMonth?: number | null;
  readonly localTime?: Date | null;
  readonly skipWeekend?: boolean;
  readonly timezone?: string;
}

export interface CreateDraftInput {
  readonly ownerId: string;
  readonly sentence: string;
  readonly mode: DeliveryMode;
  readonly targetJson: Prisma.InputJsonValue;
  readonly expiresAt: Date;
}

export interface CreateClaimInput {
  readonly notificationId: string;
  readonly effectiveDate: Date;
  readonly sourceDates: readonly Date[];
  readonly state: ClaimState;
  readonly skipReason?: SkipReason | null;
}

export interface CreateDispatchInput {
  readonly notificationId: string;
  readonly claimId: string;
  readonly sequence: number;
  readonly scheduledDate: Date;
  readonly effectiveDate: Date;
  readonly sentAt: Date;
}

export interface CreateDispatchRecipientInput {
  readonly recipientId: string;
  readonly recipientNicknameSnapshot: string;
}

export interface UsersRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByNormalizedEmail(emailNormalized: string): Promise<UserRecord | null>;
  create(input: CreateUserInput): Promise<UserRecord>;
  updateNickname(id: string, nickname: string, nicknameRequired: boolean): Promise<UserRecord | null>;
}

export interface FriendsRepository {
  find(ownerId: string, friendId: string): Promise<FriendRecord | null>;
  create(ownerId: string, friendId: string): Promise<FriendRecord>;
  listFriendIds(ownerId: string): Promise<readonly string[]>;
  /** Returns only the fields permitted in the owner's friend-list projection. */
  listForOwner(ownerId: string): Promise<readonly FriendListItemRecord[]>;
  /** Returns the minimal identity and display data for personal-recipient selection. */
  listComposeOptions(ownerId: string): Promise<readonly ComposeFriendOptionRecord[]>;
}

export interface GroupsRepository {
  findById(id: string): Promise<GroupRecord | null>;
  create(input: CreateGroupInput): Promise<GroupRecord>;
  /** Lists only groups in which the supplied user has a current membership. */
  listCurrentForUser(userId: string): Promise<readonly GroupListItem[]>;
  /**
   * Returns member display data only when the supplied user is currently a
   * member. Private member email addresses are never selected or returned.
   */
  findDetailForCurrentMember(groupId: string, userId: string): Promise<GroupDetailRecord | null>;
}

export interface MembershipsRepository {
  findCurrent(groupId: string, userId: string): Promise<MembershipRecord | null>;
  listCurrentForGroup(groupId: string): Promise<readonly MembershipRecord[]>;
  create(input: CreateMembershipInput): Promise<MembershipRecord>;
  /** Ends one active membership and returns it, or null when none is active. */
  leaveCurrent(groupId: string, userId: string): Promise<MembershipRecord | null>;
  /** Changes one active membership and returns it, or null when none is active. */
  updateCurrentVisibility(
    groupId: string,
    userId: string,
    emailVisibility: EmailVisibility,
  ): Promise<MembershipRecord | null>;
}

export interface InvitesRepository {
  findByTokenHash(tokenHash: string): Promise<InviteRecord | null>;
  create(input: CreateInviteInput): Promise<InviteRecord>;
}

export interface NotificationsRepository {
  findById(id: string): Promise<NotificationRecord | null>;
  create(input: CreateNotificationInput): Promise<NotificationRecord>;
  createPersonalTargets(notificationId: string, userIds: readonly string[]): Promise<void>;
  stopRecurring(notificationId: string, senderId: string): Promise<NotificationRecord | null>;
}

export interface NotificationDraftsRepository {
  findById(id: string): Promise<NotificationDraftRecord | null>;
  create(input: CreateDraftInput): Promise<NotificationDraftRecord>;
  /** Atomically consumes an unexpired draft owned by the supplied user. */
  consumeAvailable(id: string, ownerId: string): Promise<NotificationDraftRecord | null>;
}

export interface ScheduleClaimsRepository {
  find(notificationId: string, effectiveDate: Date): Promise<ScheduleClaimRecord | null>;
  create(input: CreateClaimInput): Promise<ScheduleClaimRecord>;
}

export interface DispatchesRepository {
  findById(id: string): Promise<DispatchRecord | null>;
  create(input: CreateDispatchInput): Promise<DispatchRecord>;
  createRecipients(
    dispatchId: string,
    recipients: readonly CreateDispatchRecipientInput[],
  ): Promise<void>;
  findRecipient(dispatchId: string, recipientId: string): Promise<DispatchRecipientRecord | null>;
  /** Sets the first confirmation time only, returning null for an existing confirmation or no row. */
  confirmRecipient(dispatchId: string, recipientId: string): Promise<DispatchRecipientRecord | null>;
}

export interface RepositoryTransaction {
  /** Serializes group membership changes and group-recipient snapshots in this transaction. */
  lockGroup(groupId: string): Promise<void>;
  /** PostgreSQL current time, evaluated by the database. */
  now(): Promise<Date>;
  /** PostgreSQL transaction timestamp, stable for the entire transaction. */
  transactionTimestamp(): Promise<Date>;
  readonly users: UsersRepository;
  readonly friends: FriendsRepository;
  readonly groups: GroupsRepository;
  readonly memberships: MembershipsRepository;
  readonly invites: InvitesRepository;
  readonly notifications: NotificationsRepository;
  readonly drafts: NotificationDraftsRepository;
  readonly claims: ScheduleClaimsRepository;
  readonly dispatches: DispatchesRepository;
}

export interface RepositoryUnitOfWork {
  transaction<T>(work: (repositories: RepositoryTransaction) => Promise<T>): Promise<T>;
}
