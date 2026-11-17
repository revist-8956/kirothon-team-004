import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { ApplicationError } from "./action-result";
import {
  scheduleNotification,
  toNotificationScheduleFields,
} from "./notification-reservations";
import type {
  CreateNotificationInput,
  MembershipRecord,
  NotificationDraftRecord,
  NotificationRecord,
  RepositoryTransaction,
  RepositoryUnitOfWork,
} from "./repositories";

// 2026-03-02 10:00 KST (Monday).
const clock = new Date("2026-03-02T01:00:00.000Z");

type StoredNotification = CreateNotificationInput & { id: string; personalTargets: string[] };

interface FixtureState {
  drafts: Map<string, NotificationDraftRecord>;
  notifications: StoredNotification[];
}

/**
 * In-memory unit of work. Work runs on a copy of the state that is committed
 * only when the work resolves, so a thrown error rolls back draft consumption
 * like the PostgreSQL transaction does.
 */
function createFixture() {
  const actorId = randomUUID();
  const friendIds = [randomUUID(), randomUUID()];
  const groupId = randomUUID();
  const memberships = new Set([`${groupId}:${actorId}`]);
  const locks: string[] = [];
  let committed: FixtureState = { drafts: new Map(), notifications: [] };

  function draft(overrides: Partial<NotificationDraftRecord> = {}): NotificationDraftRecord {
    const record: NotificationDraftRecord = {
      id: randomUUID(),
      ownerId: actorId,
      sentence: "약 챙겨 먹기",
      mode: "PERSONAL",
      targetJson: { recipientIds: [friendIds[0]!] },
      expiresAt: new Date(clock.getTime() + 30 * 60 * 1000),
      consumedAt: null,
      createdAt: clock,
      ...overrides,
    };
    committed.drafts.set(record.id, record);
    return record;
  }

  const repositories: RepositoryUnitOfWork = {
    async transaction<T>(work: (transaction: RepositoryTransaction) => Promise<T>): Promise<T> {
      const working: FixtureState = {
        drafts: new Map(committed.drafts),
        notifications: [...committed.notifications],
      };
      const transaction = {
        now: async () => clock,
        lockGroup: async (id: string) => {
          locks.push(id);
        },
        friends: { listFriendIds: async () => [...friendIds] },
        memberships: {
          findCurrent: async (id: string, userId: string) =>
            memberships.has(`${id}:${userId}`)
              ? ({
                  id: randomUUID(),
                  groupId: id,
                  userId,
                  joinedAt: clock,
                  leftAt: null,
                  emailVisibility: "PRIVATE",
                  createdAt: clock,
                } satisfies MembershipRecord)
              : null,
        },
        drafts: {
          findById: async (id: string) => working.drafts.get(id) ?? null,
          consumeAvailable: async (id: string, ownerId: string) => {
            const found = working.drafts.get(id);
            if (
              !found ||
              found.ownerId !== ownerId ||
              found.consumedAt !== null ||
              found.expiresAt.getTime() <= clock.getTime()
            ) {
              return null;
            }
            const consumed = { ...found, consumedAt: clock };
            working.drafts.set(id, consumed);
            return consumed;
          },
        },
        notifications: {
          create: async (input: CreateNotificationInput) => {
            const stored: StoredNotification = { ...input, id: randomUUID(), personalTargets: [] };
            working.notifications.push(stored);
            return { id: stored.id } as NotificationRecord;
          },
          createPersonalTargets: async (notificationId: string, userIds: readonly string[]) => {
            const index = working.notifications.findIndex((item) => item.id === notificationId);
            const stored = working.notifications[index]!;
            working.notifications[index] = { ...stored, personalTargets: [...userIds] };
          },
        },
      } as unknown as RepositoryTransaction;
      const result = await work(transaction);
      committed = working;
      return result;
    },
  };

  return {
    repositories,
    actorId,
    friendIds,
    groupId,
    memberships,
    locks,
    draft,
    state: () => committed,
  };
}

const weeklySchedule = {
  kind: "RECURRING",
  recurrence: "WEEKLY",
  startDate: "2026-03-02",
  localTime: "21:00",
  weekday: 6,
  skipWeekend: true,
  timezone: "Asia/Seoul",
} as const;

describe("scheduleNotification", () => {
  it("creates a personal notification with its fixed targets and consumes the draft", async () => {
    const fixture = createFixture();
    const draft = fixture.draft({ targetJson: { recipientIds: fixture.friendIds } });

    const result = await scheduleNotification(fixture.repositories, fixture.actorId, {
      draftId: draft.id,
      schedule: weeklySchedule,
    });

    const [stored] = fixture.state().notifications;
    expect(result).toEqual({ notificationId: stored!.id, mode: "PERSONAL" });
    expect(stored).toMatchObject({
      senderId: fixture.actorId,
      sentence: "약 챙겨 먹기",
      mode: "PERSONAL",
      groupId: null,
      scheduleKind: "RECURRING",
      recurrence: "WEEKLY",
      weekday: 6,
      dayOfMonth: null,
      skipWeekend: true,
      personalTargets: fixture.friendIds,
    });
    expect(fixture.state().drafts.get(draft.id)?.consumedAt).toEqual(clock);
  });

  it("creates a group notification only for a current member, under the group lock", async () => {
    const fixture = createFixture();
    const draft = fixture.draft({ mode: "GROUP", targetJson: { groupId: fixture.groupId } });

    const result = await scheduleNotification(fixture.repositories, fixture.actorId, {
      draftId: draft.id,
      schedule: { kind: "ONE_TIME", at: "2026-03-02T12:00:00.000Z" },
    });

    expect(result.mode).toBe("GROUP");
    expect(fixture.locks).toEqual([fixture.groupId]);
    expect(fixture.state().notifications[0]).toMatchObject({
      mode: "GROUP",
      groupId: fixture.groupId,
      scheduleKind: "ONE_TIME",
      oneTimeAt: new Date("2026-03-02T12:00:00.000Z"),
      personalTargets: [],
    });
  });

  it("creates one notification for a draft and rejects the duplicate submission", async () => {
    const fixture = createFixture();
    const draft = fixture.draft();
    const input = { draftId: draft.id, schedule: weeklySchedule };

    await scheduleNotification(fixture.repositories, fixture.actorId, input);
    await expect(scheduleNotification(fixture.repositories, fixture.actorId, input)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "이미 예약한 알림이에요.",
    } satisfies Partial<ApplicationError>);
    expect(fixture.state().notifications).toHaveLength(1);
  });

  it("reports another user's draft exactly like a missing draft", async () => {
    const fixture = createFixture();
    const othersDraft = fixture.draft({ ownerId: randomUUID() });
    const expected = {
      code: "NOT_FOUND",
      message: "알림 작성 정보를 찾을 수 없어요. 알림을 다시 작성해 주세요.",
    };

    await expect(
      scheduleNotification(fixture.repositories, fixture.actorId, {
        draftId: othersDraft.id,
        schedule: weeklySchedule,
      }),
    ).rejects.toMatchObject(expected);
    await expect(
      scheduleNotification(fixture.repositories, fixture.actorId, {
        draftId: randomUUID(),
        schedule: weeklySchedule,
      }),
    ).rejects.toMatchObject(expected);
    await expect(
      scheduleNotification(fixture.repositories, fixture.actorId, {
        draftId: "not-a-uuid",
        schedule: weeklySchedule,
      }),
    ).rejects.toMatchObject(expected);
    expect(fixture.state().drafts.get(othersDraft.id)?.consumedAt).toBeNull();
  });

  it("rejects an expired draft", async () => {
    const fixture = createFixture();
    const draft = fixture.draft({ expiresAt: clock });

    await expect(
      scheduleNotification(fixture.repositories, fixture.actorId, {
        draftId: draft.id,
        schedule: weeklySchedule,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: "작성한 지 30분이 지났어요. 알림을 다시 작성해 주세요." });
  });

  it("re-checks permissions and leaves the draft reusable when they no longer hold", async () => {
    const fixture = createFixture();
    const personal = fixture.draft({ targetJson: { recipientIds: [randomUUID()] } });
    const group = fixture.draft({ mode: "GROUP", targetJson: { groupId: fixture.groupId } });
    fixture.memberships.clear();

    await expect(
      scheduleNotification(fixture.repositories, fixture.actorId, {
        draftId: personal.id,
        schedule: weeklySchedule,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "친구가 아닌 사용자는 선택할 수 없어요." });
    await expect(
      scheduleNotification(fixture.repositories, fixture.actorId, {
        draftId: group.id,
        schedule: weeklySchedule,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "선택한 그룹에 알림을 보낼 권한이 없어요." });

    expect(fixture.state().notifications).toEqual([]);
    expect(fixture.state().drafts.get(personal.id)?.consumedAt).toBeNull();
    expect(fixture.state().drafts.get(group.id)?.consumedAt).toBeNull();
  });

  it("rejects past one-time instants and past recurring start dates without consuming the draft", async () => {
    const fixture = createFixture();
    const draft = fixture.draft();

    await expect(
      scheduleNotification(fixture.repositories, fixture.actorId, {
        draftId: draft.id,
        schedule: { kind: "ONE_TIME", at: clock.toISOString() },
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: { oneTimeDate: ["과거 시각에는 예약할 수 없어요."] },
    });
    await expect(
      scheduleNotification(fixture.repositories, fixture.actorId, {
        draftId: draft.id,
        schedule: { ...weeklySchedule, startDate: "2026-03-01" },
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: { startDate: ["반복 시작일은 오늘 이후로 선택해 주세요."] },
    });
    expect(fixture.state().drafts.get(draft.id)?.consumedAt).toBeNull();
  });

  it("rejects malformed recurrence fields with field errors", async () => {
    const fixture = createFixture();
    const draft = fixture.draft();
    const attempt = (schedule: Record<string, unknown>) =>
      scheduleNotification(fixture.repositories, fixture.actorId, { draftId: draft.id, schedule });

    await expect(attempt({ ...weeklySchedule, weekday: undefined })).rejects.toMatchObject({
      fieldErrors: { weekday: ["요일을 선택해 주세요."] },
    });
    await expect(
      attempt({ ...weeklySchedule, recurrence: "MONTHLY", weekday: undefined, dayOfMonth: 32 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fieldErrors: { dayOfMonth: expect.any(Array) } });
    await expect(
      attempt({ ...weeklySchedule, recurrence: "DAILY", weekday: 3 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fieldErrors: { weekday: expect.any(Array) } });
    await expect(attempt({ ...weeklySchedule, localTime: "24:00" })).rejects.toMatchObject({
      fieldErrors: { localTime: ["발송 시각을 선택해 주세요."] },
    });
    await expect(attempt({ ...weeklySchedule, startDate: "2026-02-30" })).rejects.toMatchObject({
      fieldErrors: { startDate: ["날짜를 선택해 주세요."] },
    });
    await expect(attempt({ ...weeklySchedule, timezone: "UTC" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(fixture.state().notifications).toEqual([]);
  });
});

describe("toNotificationScheduleFields", () => {
  it("stores the KST calendar date and wall-clock time without timezone conversion", () => {
    expect(
      toNotificationScheduleFields({
        kind: "RECURRING",
        recurrence: "MONTHLY",
        startDate: "2026-01-31",
        localTime: "09:30",
        dayOfMonth: 31,
        skipWeekend: false,
        timezone: "Asia/Seoul",
      }),
    ).toEqual({
      scheduleKind: "RECURRING",
      oneTimeAt: null,
      recurrence: "MONTHLY",
      startDate: new Date("2026-01-31T00:00:00.000Z"),
      weekday: null,
      dayOfMonth: 31,
      localTime: new Date("1970-01-01T09:30:00.000Z"),
      skipWeekend: false,
      timezone: "Asia/Seoul",
    });
  });
});
