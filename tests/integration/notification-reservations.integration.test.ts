import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import { afterEach, describe, expect, it } from "vitest";

import { addFriend } from "@/application/friends";
import { createGroup, leaveGroup } from "@/application/group-memberships";
import { createNotificationDraft } from "@/application/notification-drafts";
import { scheduleNotification } from "@/application/notification-reservations";
import { SCHEDULE_TIMEZONE } from "@/domain/schedule";
import { PrismaRepositoryUnitOfWork } from "@/infrastructure/prisma-repositories";
import { registerIsolatedPostgres } from "@/tests/database/postgres-test-database";
import { createSupabaseProfileUser } from "@/tests/database/supabase-auth-schema";

const fixture = registerIsolatedPostgres();
const clients: PrismaClient[] = [];

function createRepositories(): PrismaRepositoryUnitOfWork {
  const client = new PrismaClient({ datasources: { db: { url: fixture.current.url } } });
  clients.push(client);
  return new PrismaRepositoryUnitOfWork(client);
}

async function createUser(repositories: PrismaRepositoryUnitOfWork, nickname: string) {
  return createSupabaseProfileUser(fixture.current.pool, repositories, {
    email: `${randomUUID()}@example.test`,
    nickname,
  });
}

/** A KST calendar date relative to the real clock, since the command uses database time. */
function kstDate(daysFromToday: number): string {
  return DateTime.now().setZone(SCHEDULE_TIMEZONE).plus({ days: daysFromToday }).toISODate()!;
}

async function senderWithFriend() {
  const repositories = createRepositories();
  const sender = await createUser(repositories, "엄마");
  const friend = await createUser(repositories, "딸");
  await addFriend(repositories, sender.id, { email: friend.email });
  return { repositories, sender, friend };
}

async function storedNotifications() {
  const result = await fixture.current.pool.query<{
    id: string;
    mode: string;
    group_id: string | null;
    schedule_kind: string;
    one_time_at: Date | null;
    recurrence: string | null;
    start_date: string | null;
    weekday: number | null;
    day_of_month: number | null;
    local_time: string | null;
    skip_weekend: boolean;
    targets: string[];
  }>(
    `SELECT n."id", n."mode", n."group_id", n."schedule_kind", n."one_time_at", n."recurrence",
            n."start_date"::text AS "start_date", n."weekday", n."day_of_month",
            n."local_time"::text AS "local_time", n."skip_weekend",
            COALESCE(array_agg(t."user_id"::text) FILTER (WHERE t."user_id" IS NOT NULL), '{}') AS "targets"
     FROM "notification" n
     LEFT JOIN "personal_target" t ON t."notification_id" = n."id"
     GROUP BY n."id"
     ORDER BY n."created_at" ASC`,
  );
  return result.rows;
}

async function draftConsumedAt(draftId: string): Promise<Date | null> {
  const result = await fixture.current.pool.query<{ consumed_at: Date | null }>(
    `SELECT "consumed_at" FROM "notification_draft" WHERE "id" = $1`,
    [draftId],
  );
  return result.rows[0]!.consumed_at;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
});

describe("notification reservation against isolated PostgreSQL", () => {
  it("stores each schedule type in KST columns with the personal targets", async () => {
    const { repositories, sender, friend } = await senderWithFriend();
    const oneTimeAt = DateTime.now().plus({ days: 2 }).startOf("minute").toUTC();
    const schedules = [
      { kind: "ONE_TIME", at: oneTimeAt.toISO() },
      {
        kind: "RECURRING",
        recurrence: "DAILY",
        startDate: kstDate(0),
        localTime: "21:00",
        skipWeekend: false,
      },
      {
        kind: "RECURRING",
        recurrence: "WEEKLY",
        startDate: kstDate(1),
        localTime: "09:05",
        weekday: 6,
        skipWeekend: true,
      },
      {
        kind: "RECURRING",
        recurrence: "MONTHLY",
        startDate: kstDate(1),
        localTime: "23:59",
        dayOfMonth: 31,
        skipWeekend: true,
      },
    ];

    for (const schedule of schedules) {
      const draft = await createNotificationDraft(repositories, sender.id, {
        sentence: "저녁 약 챙겨 먹기",
        mode: "PERSONAL",
        recipientIds: [friend.id],
      });
      await scheduleNotification(repositories, sender.id, { draftId: draft.id, schedule });
      expect(await draftConsumedAt(draft.id)).not.toBeNull();
    }

    const rows = await storedNotifications();
    expect(rows.map((row) => ({ ...row, id: undefined }))).toEqual([
      {
        id: undefined,
        mode: "PERSONAL",
        group_id: null,
        schedule_kind: "ONE_TIME",
        one_time_at: oneTimeAt.toJSDate(),
        recurrence: null,
        start_date: null,
        weekday: null,
        day_of_month: null,
        local_time: null,
        skip_weekend: false,
        targets: [friend.id],
      },
      {
        id: undefined,
        mode: "PERSONAL",
        group_id: null,
        schedule_kind: "RECURRING",
        one_time_at: null,
        recurrence: "DAILY",
        start_date: kstDate(0),
        weekday: null,
        day_of_month: null,
        local_time: "21:00:00",
        skip_weekend: false,
        targets: [friend.id],
      },
      {
        id: undefined,
        mode: "PERSONAL",
        group_id: null,
        schedule_kind: "RECURRING",
        one_time_at: null,
        recurrence: "WEEKLY",
        start_date: kstDate(1),
        weekday: 6,
        day_of_month: null,
        local_time: "09:05:00",
        skip_weekend: true,
        targets: [friend.id],
      },
      {
        id: undefined,
        mode: "PERSONAL",
        group_id: null,
        schedule_kind: "RECURRING",
        one_time_at: null,
        recurrence: "MONTHLY",
        start_date: kstDate(1),
        weekday: null,
        day_of_month: 31,
        local_time: "23:59:00",
        skip_weekend: true,
        targets: [friend.id],
      },
    ]);
  });

  it("creates one group notification without personal targets for a current member", async () => {
    const repositories = createRepositories();
    const sender = await createUser(repositories, "엄마");
    const { group } = await createGroup(repositories, { actorId: sender.id, name: "우리 가족" });
    const draft = await createNotificationDraft(repositories, sender.id, {
      sentence: "저녁 약 챙겨 먹기",
      mode: "GROUP",
      groupId: group.id,
    });

    await expect(
      scheduleNotification(repositories, sender.id, {
        draftId: draft.id,
        schedule: {
          kind: "RECURRING",
          recurrence: "DAILY",
          startDate: kstDate(0),
          localTime: "21:00",
          skipWeekend: true,
        },
      }),
    ).resolves.toMatchObject({ mode: "GROUP" });

    expect(await storedNotifications()).toMatchObject([
      { mode: "GROUP", group_id: group.id, targets: [] },
    ]);
  });

  it("creates exactly one notification when the same draft is submitted concurrently", async () => {
    const { repositories, sender, friend } = await senderWithFriend();
    const otherConnection = createRepositories();
    const draft = await createNotificationDraft(repositories, sender.id, {
      sentence: "오늘 약속 기억하기",
      mode: "PERSONAL",
      recipientIds: [friend.id],
    });
    const input = {
      draftId: draft.id,
      schedule: { kind: "ONE_TIME", at: DateTime.now().plus({ hours: 3 }).toUTC().toISO() },
    };

    const results = await Promise.allSettled([
      scheduleNotification(repositories, sender.id, input),
      scheduleNotification(otherConnection, sender.id, input),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "CONFLICT" });
    expect(await storedNotifications()).toHaveLength(1);
  });

  it("rejects expired and foreign drafts without creating notifications", async () => {
    const { repositories, sender, friend } = await senderWithFriend();
    const stranger = await createUser(repositories, "모르는 사람");
    const expired = await createNotificationDraft(repositories, sender.id, {
      sentence: "만료될 알림",
      mode: "PERSONAL",
      recipientIds: [friend.id],
    });
    await fixture.current.pool.query(
      `UPDATE "notification_draft" SET "expires_at" = now() - interval '1 second' WHERE "id" = $1`,
      [expired.id],
    );
    const fresh = await createNotificationDraft(repositories, sender.id, {
      sentence: "다른 사람이 쓰면 안 되는 알림",
      mode: "PERSONAL",
      recipientIds: [friend.id],
    });
    const schedule = {
      kind: "RECURRING",
      recurrence: "DAILY",
      startDate: kstDate(1),
      localTime: "08:00",
      skipWeekend: false,
    };

    await expect(
      scheduleNotification(repositories, sender.id, { draftId: expired.id, schedule }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      scheduleNotification(repositories, stranger.id, { draftId: fresh.id, schedule }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await storedNotifications()).toEqual([]);
    expect(await draftConsumedAt(fresh.id)).toBeNull();
  });

  it("re-checks friendship and current membership at reservation time and keeps the draft", async () => {
    const { repositories, sender, friend } = await senderWithFriend();
    const { group } = await createGroup(repositories, { actorId: sender.id, name: "회사" });
    const personal = await createNotificationDraft(repositories, sender.id, {
      sentence: "보고서 제출",
      mode: "PERSONAL",
      recipientIds: [friend.id],
    });
    const groupDraft = await createNotificationDraft(repositories, sender.id, {
      sentence: "회의 자료 확인",
      mode: "GROUP",
      groupId: group.id,
    });
    await fixture.current.pool.query(`DELETE FROM "friends" WHERE "owner_id" = $1`, [sender.id]);
    await leaveGroup(repositories, { actorId: sender.id, groupId: group.id, confirmation: true });
    const schedule = { kind: "ONE_TIME", at: DateTime.now().plus({ days: 1 }).toUTC().toISO() };

    await expect(
      scheduleNotification(repositories, sender.id, { draftId: personal.id, schedule }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      scheduleNotification(repositories, sender.id, { draftId: groupDraft.id, schedule }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await storedNotifications()).toEqual([]);
    expect(await draftConsumedAt(personal.id)).toBeNull();
    expect(await draftConsumedAt(groupDraft.id)).toBeNull();
  });
});
