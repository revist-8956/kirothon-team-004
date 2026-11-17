import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import { afterEach, describe, expect, it } from "vitest";

import { findDueSlots, processDueSlot } from "@/application/dispatch-scheduler";
import { addFriend } from "@/application/friends";
import { acceptGroupInvite, createGroup, leaveGroup } from "@/application/group-memberships";
import { createNotificationDraft } from "@/application/notification-drafts";
import { scheduleNotification } from "@/application/notification-reservations";
import { SCHEDULE_TIMEZONE } from "@/domain/schedule";
import { PrismaRepositoryUnitOfWork } from "@/infrastructure/prisma-repositories";
import { registerIsolatedPostgres } from "@/tests/database/postgres-test-database";
import { createSupabaseProfileUser } from "@/tests/database/supabase-auth-schema";

const fixture = registerIsolatedPostgres();
const clients: PrismaClient[] = [];
const options = { lookbackDays: 35, batchSize: 50 };

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

function kst(): DateTime {
  return DateTime.now().setZone(SCHEDULE_TIMEZONE);
}

/** The first KST Saturday at least two days from today. */
function upcomingSaturday(): DateTime {
  const start = kst().plus({ days: 2 }).startOf("day");
  return start.plus({ days: (6 - start.weekday + 7) % 7 });
}

async function reserve(
  repositories: PrismaRepositoryUnitOfWork,
  senderId: string,
  target: { recipientIds: string[] } | { groupId: string },
  schedule: Record<string, unknown>,
) {
  const draft = await createNotificationDraft(repositories, senderId, {
    sentence: "저녁 약 챙겨 먹기",
    ...("groupId" in target ? { mode: "GROUP", groupId: target.groupId } : { mode: "PERSONAL", ...target }),
  });
  const { notificationId } = await scheduleNotification(repositories, senderId, {
    draftId: draft.id,
    schedule,
  });
  return notificationId;
}

async function runTick(repositories: PrismaRepositoryUnitOfWork, now: Date) {
  const candidates = await findDueSlots(repositories, options, now);
  const outcomes = [];
  for (const candidate of candidates) {
    outcomes.push(await processDueSlot(repositories, candidate));
  }
  return { candidates, outcomes };
}

async function dispatchRows(notificationId: string) {
  const result = await fixture.current.pool.query<{
    sequence: number;
    scheduled_date: string;
    effective_date: string;
    recipients: Array<{ recipient_id: string; nickname: string; confirmed_at: string | null }>;
  }>(
    `SELECT d."sequence", d."scheduled_date"::text AS "scheduled_date",
            d."effective_date"::text AS "effective_date",
            COALESCE(json_agg(json_build_object(
              'recipient_id', r."recipient_id", 'nickname', r."recipient_nickname_snapshot",
              'confirmed_at', r."confirmed_at") ORDER BY r."recipient_nickname_snapshot")
              FILTER (WHERE r."id" IS NOT NULL), '[]') AS "recipients"
     FROM "dispatch" d
     LEFT JOIN "dispatch_recipient" r ON r."dispatch_id" = d."id"
     WHERE d."notification_id" = $1
     GROUP BY d."id"
     ORDER BY d."sequence"`,
    [notificationId],
  );
  return result.rows;
}

async function claimRows(notificationId: string) {
  const result = await fixture.current.pool.query<{
    effective_date: string;
    source_dates: string;
    state: string;
    skip_reason: string | null;
  }>(
    `SELECT "effective_date"::text AS "effective_date", "source_dates"::text AS "source_dates",
            "state"::text AS "state", "skip_reason"::text AS "skip_reason"
     FROM "schedule_claim" WHERE "notification_id" = $1 ORDER BY "effective_date"`,
    [notificationId],
  );
  return result.rows;
}

async function familyGroup(repositories: PrismaRepositoryUnitOfWork) {
  const mom = await createUser(repositories, "엄마");
  const dad = await createUser(repositories, "아빠");
  const daughter = await createUser(repositories, "딸");
  const { group } = await createGroup(repositories, { actorId: mom.id, name: "우리 가족" });
  await acceptGroupInvite(repositories, { actorId: dad.id, groupId: group.id });
  await acceptGroupInvite(repositories, { actorId: daughter.id, groupId: group.id });
  return { mom, dad, daughter, group };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
});

describe("dispatch scheduler against isolated PostgreSQL", () => {
  it("sends a due personal one-time slot exactly once with unconfirmed nickname snapshots", async () => {
    const repositories = createRepositories();
    const mom = await createUser(repositories, "엄마");
    const daughter = await createUser(repositories, "딸");
    await addFriend(repositories, mom.id, { email: daughter.email });
    const at = DateTime.now().plus({ hours: 2 }).startOf("minute").toUTC();
    const notificationId = await reserve(repositories, mom.id, { recipientIds: [daughter.id] }, {
      kind: "ONE_TIME",
      at: at.toISO(),
    });

    expect((await findDueSlots(repositories, options, at.minus({ minutes: 1 }).toJSDate()))).toEqual([]);

    const first = await runTick(repositories, at.toJSDate());
    expect(first.outcomes).toEqual([{ kind: "SENT", dispatchId: expect.any(String), recipientCount: 1 }]);
    expect(await dispatchRows(notificationId)).toEqual([
      {
        sequence: 1,
        scheduled_date: at.setZone(SCHEDULE_TIMEZONE).toISODate(),
        effective_date: at.setZone(SCHEDULE_TIMEZONE).toISODate(),
        recipients: [{ recipient_id: daughter.id, nickname: "딸", confirmed_at: null }],
      },
    ]);

    const later = at.plus({ hours: 1 }).toJSDate();
    expect((await runTick(repositories, later)).candidates).toEqual([]);
    expect(await processDueSlot(repositories, first.candidates[0]!)).toEqual({ kind: "ALREADY_CLAIMED" });
    expect(await dispatchRows(notificationId)).toHaveLength(1);
  });

  it("catches up daily slots in order and merges a weekend into Monday", async () => {
    const repositories = createRepositories();
    const mom = await createUser(repositories, "엄마");
    const dad = await createUser(repositories, "아빠");
    await addFriend(repositories, mom.id, { email: dad.email });
    const saturday = upcomingSaturday();
    const friday = saturday.minus({ days: 1 });
    const notificationId = await reserve(repositories, mom.id, { recipientIds: [dad.id] }, {
      kind: "RECURRING",
      recurrence: "DAILY",
      startDate: friday.toISODate(),
      localTime: "09:00",
      skipWeekend: true,
    });
    const tuesdayMorning = saturday.plus({ days: 3, hours: 10 });

    const tick = await runTick(repositories, tuesdayMorning.toJSDate());

    expect(tick.outcomes.map((outcome) => outcome.kind)).toEqual(["SENT", "SENT", "SENT"]);
    const monday = saturday.plus({ days: 2 }).toISODate()!;
    expect(
      (await dispatchRows(notificationId)).map((row) => [row.sequence, row.scheduled_date, row.effective_date]),
    ).toEqual([
      [1, friday.toISODate(), friday.toISODate()],
      [2, saturday.toISODate(), monday],
      [3, saturday.plus({ days: 3 }).toISODate(), saturday.plus({ days: 3 }).toISODate()],
    ]);
    expect((await claimRows(notificationId))[1]).toEqual({
      effective_date: monday,
      source_dates: `{${saturday.toISODate()},${saturday.plus({ days: 1 }).toISODate()},${monday}}`,
      state: "SENT",
      skip_reason: null,
    });
  });

  it("snapshots current group members except the sender at dispatch time", async () => {
    const repositories = createRepositories();
    const { mom, dad, daughter, group } = await familyGroup(repositories);
    const start = kst().plus({ days: 1 });
    const notificationId = await reserve(repositories, mom.id, { groupId: group.id }, {
      kind: "RECURRING",
      recurrence: "DAILY",
      startDate: start.toISODate(),
      localTime: "21:00",
      skipWeekend: false,
    });

    await runTick(repositories, start.set({ hour: 21, minute: 1 }).toJSDate());
    await leaveGroup(repositories, { actorId: dad.id, groupId: group.id, confirmation: true });
    await runTick(repositories, start.plus({ days: 1 }).set({ hour: 21, minute: 1 }).toJSDate());

    const rows = await dispatchRows(notificationId);
    expect(rows.map((row) => row.recipients.map((recipient) => recipient.nickname))).toEqual([
      ["딸", "아빠"],
      ["딸"],
    ]);
    // The first dispatch keeps its recipient list after the later membership change.
    expect(rows[0]!.recipients.map((recipient) => recipient.recipient_id).sort()).toEqual(
      [dad.id, daughter.id].sort(),
    );
  });

  it("records a skipped claim without a dispatch when the sender left or nobody else remains", async () => {
    const repositories = createRepositories();
    const { dad, group } = await familyGroup(repositories);
    const solo = await createUser(repositories, "혼자");
    const { group: soloGroup } = await createGroup(repositories, { actorId: solo.id, name: "나만" });
    const at = DateTime.now().plus({ hours: 2 }).startOf("minute").toUTC();
    const schedule = { kind: "ONE_TIME", at: at.toISO() };
    const leftSender = await reserve(repositories, dad.id, { groupId: group.id }, schedule);
    const noRecipients = await reserve(repositories, solo.id, { groupId: soloGroup.id }, schedule);
    await leaveGroup(repositories, { actorId: dad.id, groupId: group.id, confirmation: true });

    const tick = await runTick(repositories, at.toJSDate());

    expect(tick.outcomes).toEqual(
      expect.arrayContaining([
        { kind: "SKIPPED", reason: "SENDER_NOT_MEMBER" },
        { kind: "SKIPPED", reason: "NO_RECIPIENTS" },
      ]),
    );
    expect(await claimRows(leftSender)).toMatchObject([{ state: "SKIPPED", skip_reason: "SENDER_NOT_MEMBER" }]);
    expect(await claimRows(noRecipients)).toMatchObject([{ state: "SKIPPED", skip_reason: "NO_RECIPIENTS" }]);
    expect(await dispatchRows(leftSender)).toEqual([]);
    expect(await dispatchRows(noRecipients)).toEqual([]);
    // A skipped slot is final and is not offered again.
    expect((await runTick(repositories, at.plus({ minutes: 5 }).toJSDate())).candidates).toEqual([]);
  });

  it("creates one claim and one dispatch when two connections process the same slot", async () => {
    const repositories = createRepositories();
    const otherConnection = createRepositories();
    const { mom, group } = await familyGroup(repositories);
    const at = DateTime.now().plus({ hours: 2 }).startOf("minute").toUTC();
    const notificationId = await reserve(repositories, mom.id, { groupId: group.id }, {
      kind: "ONE_TIME",
      at: at.toISO(),
    });
    const [candidate] = await findDueSlots(repositories, options, at.toJSDate());

    const outcomes = await Promise.all([
      processDueSlot(repositories, candidate!),
      processDueSlot(otherConnection, candidate!),
    ]);

    expect(outcomes.filter((outcome) => outcome.kind === "SENT")).toHaveLength(1);
    expect(["LOCKED", "ALREADY_CLAIMED"]).toContain(
      outcomes.find((outcome) => outcome.kind !== "SENT")!.kind,
    );
    expect(await claimRows(notificationId)).toHaveLength(1);
    expect(await dispatchRows(notificationId)).toHaveLength(1);
  });
});
