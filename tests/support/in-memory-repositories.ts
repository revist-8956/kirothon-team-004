import { randomUUID } from "node:crypto";

import type {
  CreateClaimInput,
  CreateDispatchInput,
  CreateDispatchRecipientInput,
  CreateNotificationInput,
  DispatchRecipientRecord,
  DispatchRecord,
  DispatchRoundRecord,
  MembershipRecord,
  NotificationRecord,
  RepositoryTransaction,
  RepositoryUnitOfWork,
  ScheduleClaimRecord,
} from "@/application/repositories";

/**
 * In-memory model of the repository operations used by the scheduler,
 * confirmation and response-status code. It runs the real application
 * commands so property tests can explore many histories quickly. SQL-only
 * rules (inbox and sent-list filters) are verified against PostgreSQL in
 * tests/integration instead.
 *
 * Each transaction works on a copy of the state and commits only when the
 * work resolves, like a database transaction.
 */
interface State {
  users: Map<string, { id: string; nickname: string }>;
  groups: Map<string, { id: string; name: string; createdById: string }>;
  memberships: MembershipRecord[];
  notifications: Map<string, NotificationRecord>;
  personalTargets: Array<{ notificationId: string; userId: string }>;
  claims: ScheduleClaimRecord[];
  dispatches: DispatchRecord[];
  recipients: DispatchRecipientRecord[];
}

function emptyState(): State {
  return {
    users: new Map(),
    groups: new Map(),
    memberships: [],
    notifications: new Map(),
    personalTargets: [],
    claims: [],
    dispatches: [],
    recipients: [],
  };
}

function copyState(state: State): State {
  return {
    users: new Map(state.users),
    groups: new Map(state.groups),
    memberships: state.memberships.map((row) => ({ ...row })),
    notifications: new Map([...state.notifications].map(([id, row]) => [id, { ...row }])),
    personalTargets: state.personalTargets.map((row) => ({ ...row })),
    claims: state.claims.map((row) => ({ ...row })),
    dispatches: state.dispatches.map((row) => ({ ...row })),
    recipients: state.recipients.map((row) => ({ ...row })),
  };
}

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

export function createInMemoryRepositories(startAt = new Date("2026-03-02T00:00:00.000Z")) {
  let state = emptyState();
  let clock = startAt.getTime();

  const tick = (milliseconds = 1_000) => {
    clock += milliseconds;
  };
  const now = () => new Date(clock);

  function transactionFor(working: State): RepositoryTransaction {
    const currentMembership = (groupId: string, userId: string) =>
      working.memberships
        .filter((row) => row.groupId === groupId && row.userId === userId && row.leftAt === null)
        .sort((left, right) => right.joinedAt.getTime() - left.joinedAt.getTime())[0] ?? null;

    const transaction = {
      now: async () => now(),
      transactionTimestamp: async () => now(),
      lockGroup: async () => {},
      tryLockNotification: async () => true,
      users: {
        findById: async (id: string) => {
          const user = working.users.get(id);
          return user ? { ...user, email: "", emailNormalized: "", nicknameRequired: false, createdAt: now(), updatedAt: now() } : null;
        },
      },
      groups: {
        findById: async (id: string) => {
          const group = working.groups.get(id);
          return group ? { ...group, createdAt: now() } : null;
        },
      },
      memberships: {
        findCurrent: async (groupId: string, userId: string) => currentMembership(groupId, userId),
        listCurrentMemberProfiles: async (groupId: string) =>
          working.memberships
            .filter((row) => row.groupId === groupId && row.leftAt === null)
            .map((row) => ({ userId: row.userId, nickname: working.users.get(row.userId)?.nickname ?? "" })),
      },
      notifications: {
        findById: async (id: string) => working.notifications.get(id) ?? null,
        listPersonalTargetProfiles: async (notificationId: string) =>
          working.personalTargets
            .filter((row) => row.notificationId === notificationId)
            .map((row) => ({ userId: row.userId, nickname: working.users.get(row.userId)?.nickname ?? "" })),
      },
      claims: {
        find: async (notificationId: string, effectiveDate: Date) =>
          working.claims.find(
            (row) => row.notificationId === notificationId && dateKey(row.effectiveDate) === dateKey(effectiveDate),
          ) ?? null,
        create: async (input: CreateClaimInput) => {
          if (working.claims.some((row) => row.notificationId === input.notificationId && dateKey(row.effectiveDate) === dateKey(input.effectiveDate))) {
            throw Object.assign(new Error("unique violation"), { code: "P2002" });
          }
          const claim: ScheduleClaimRecord = {
            id: randomUUID(),
            notificationId: input.notificationId,
            effectiveDate: input.effectiveDate,
            sourceDates: [...input.sourceDates],
            state: input.state,
            skipReason: input.skipReason ?? null,
            createdAt: now(),
          };
          working.claims.push(claim);
          return claim;
        },
      },
      dispatches: {
        findById: async (id: string) => working.dispatches.find((row) => row.id === id) ?? null,
        create: async (input: CreateDispatchInput) => {
          const dispatch: DispatchRecord = { id: randomUUID(), ...input, createdAt: now() };
          working.dispatches.push(dispatch);
          return dispatch;
        },
        nextSequence: async (notificationId: string) =>
          Math.max(0, ...working.dispatches.filter((row) => row.notificationId === notificationId).map((row) => row.sequence)) + 1,
        createRecipients: async (dispatchId: string, recipients: readonly CreateDispatchRecipientInput[]) => {
          for (const recipient of recipients) {
            working.recipients.push({ id: randomUUID(), dispatchId, ...recipient, confirmedAt: null, createdAt: now() });
          }
        },
        findRecipient: async (dispatchId: string, recipientId: string) =>
          working.recipients.find((row) => row.dispatchId === dispatchId && row.recipientId === recipientId) ?? null,
        confirmRecipient: async (dispatchId: string, recipientId: string) => {
          const index = working.recipients.findIndex(
            (row) => row.dispatchId === dispatchId && row.recipientId === recipientId && row.confirmedAt === null,
          );
          if (index === -1) {
            return null;
          }
          const confirmed = { ...working.recipients[index]!, confirmedAt: now() };
          working.recipients[index] = confirmed;
          return confirmed;
        },
        listRoundsForNotification: async (notificationId: string): Promise<DispatchRoundRecord[]> =>
          working.dispatches
            .filter((row) => row.notificationId === notificationId)
            .sort((left, right) => left.sequence - right.sequence)
            .map((row) => {
              const rows = working.recipients.filter((recipient) => recipient.dispatchId === row.id);
              return {
                dispatchId: row.id,
                sequence: row.sequence,
                effectiveDate: dateKey(row.effectiveDate),
                sentAt: row.sentAt,
                recipientCount: rows.length,
                confirmedCount: rows.filter((recipient) => recipient.confirmedAt !== null).length,
              };
            }),
        listResponses: async (dispatchId: string) =>
          working.recipients
            .filter((row) => row.dispatchId === dispatchId)
            .sort((left, right) => left.recipientNicknameSnapshot.localeCompare(right.recipientNicknameSnapshot))
            .map((row) => ({ recipientId: row.recipientId, nickname: row.recipientNicknameSnapshot, confirmedAt: row.confirmedAt })),
      },
    };
    return transaction as unknown as RepositoryTransaction;
  }

  const repositories: RepositoryUnitOfWork = {
    async transaction<T>(work: (transaction: RepositoryTransaction) => Promise<T>): Promise<T> {
      const working = copyState(state);
      const result = await work(transactionFor(working));
      state = working;
      return result;
    },
  };

  /** Direct setup helpers; they bypass commands and advance the clock. */
  const setup = {
    user(nickname: string) {
      const id = randomUUID();
      state.users.set(id, { id, nickname });
      return id;
    },
    group(name: string, createdById: string) {
      const id = randomUUID();
      state.groups.set(id, { id, name, createdById });
      return id;
    },
    join(groupId: string, userId: string) {
      tick();
      state.memberships.push({
        id: randomUUID(),
        groupId,
        userId,
        joinedAt: now(),
        leftAt: null,
        emailVisibility: "PRIVATE",
        createdAt: now(),
      });
    },
    leave(groupId: string, userId: string) {
      tick();
      state.memberships = state.memberships.map((row) =>
        row.groupId === groupId && row.userId === userId && row.leftAt === null ? { ...row, leftAt: now() } : row,
      );
    },
    notification(input: Pick<CreateNotificationInput, "senderId" | "mode"> & { groupId?: string | null; targets?: string[] }) {
      tick();
      const id = randomUUID();
      state.notifications.set(id, {
        id,
        senderId: input.senderId,
        sentence: "저녁 약 챙겨 먹기",
        mode: input.mode,
        groupId: input.groupId ?? null,
        scheduleKind: "RECURRING",
        oneTimeAt: null,
        recurrence: "DAILY",
        startDate: new Date("2026-03-01T00:00:00.000Z"),
        weekday: null,
        dayOfMonth: null,
        localTime: new Date("1970-01-01T09:00:00.000Z"),
        skipWeekend: false,
        timezone: "Asia/Seoul",
        state: "ACTIVE",
        stoppedAt: null,
        createdAt: now(),
      });
      for (const userId of input.targets ?? []) {
        state.personalTargets.push({ notificationId: id, userId });
      }
      return id;
    },
  };

  return {
    repositories,
    setup,
    tick,
    now,
    /** Read-only snapshot of committed rows. */
    snapshot: () => copyState(state),
  };
}

export type InMemoryRepositories = ReturnType<typeof createInMemoryRepositories>;
