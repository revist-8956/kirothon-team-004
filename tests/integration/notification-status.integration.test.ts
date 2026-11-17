import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import { afterEach, describe, expect, it } from "vitest";

import { runSchedulerTick } from "@/application/dispatch-scheduler";
import { addFriend } from "@/application/friends";
import { acceptGroupInvite, createGroup, leaveGroup } from "@/application/group-memberships";
import { confirmDispatch } from "@/application/inbox";
import { createNotificationDraft } from "@/application/notification-drafts";
import { scheduleNotification } from "@/application/notification-reservations";
import {
  getNotificationStatus,
  getSentNotifications,
  stopRecurringNotification,
  type NotificationStatusView,
} from "@/application/notification-status";
import { SCHEDULE_TIMEZONE } from "@/domain/schedule";
import { PrismaRepositoryUnitOfWork } from "@/infrastructure/prisma-repositories";
import { registerIsolatedPostgres } from "@/tests/database/postgres-test-database";
import { createSupabaseProfileUser } from "@/tests/database/supabase-auth-schema";

const fixture = registerIsolatedPostgres();
const clients: PrismaClient[] = [];
const tickOptions = { lookbackDays: 35, batchSize: 50 };

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
  return (await scheduleNotification(repositories, senderId, { draftId: draft.id, schedule })).notificationId;
}

const tomorrow = () => DateTime.now().setZone(SCHEDULE_TIMEZONE).plus({ days: 1 });

function dailyAt21(start: DateTime) {
  return { kind: "RECURRING", recurrence: "DAILY", startDate: start.toISODate(), localTime: "21:00", skipWeekend: false };
}

/** Runs the scheduler at 21:01 KST on the n-th day (0-based) after `start`. */
async function sendRound(repositories: PrismaRepositoryUnitOfWork, start: DateTime, day: number) {
  await runSchedulerTick(repositories, tickOptions, start.plus({ days: day }).set({ hour: 21, minute: 1 }).toJSDate());
}

function visible(status: NotificationStatusView) {
  if (status.kind !== "VISIBLE") {
    throw new Error("expected a visible status");
  }
  return status;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
});

describe("personal response status", () => {
  async function personalRounds() {
    const repositories = createRepositories();
    const sender = await createUser(repositories, "민수");
    const yuna = await createUser(repositories, "유나");
    const jisu = await createUser(repositories, "지수");
    await addFriend(repositories, sender.id, { email: yuna.email });
    await addFriend(repositories, sender.id, { email: jisu.email });
    const start = tomorrow();
    const notificationId = await reserve(repositories, sender.id, { recipientIds: [yuna.id, jisu.id] }, dailyAt21(start));
    await sendRound(repositories, start, 0);
    await sendRound(repositories, start, 1);
    return { repositories, sender, yuna, jisu, notificationId };
  }

  it("shows the sender every round and recipient with snapshot-based counts", async () => {
    const { repositories, sender, yuna, notificationId } = await personalRounds();
    const latest = visible(await getNotificationStatus(repositories, sender.id, notificationId)).selected!;
    await confirmDispatch(repositories, yuna.id, latest.dispatchId);

    const status = visible(await getNotificationStatus(repositories, sender.id, notificationId));

    expect(status.notification).toMatchObject({ sentence: "저녁 약 챙겨 먹기", mode: "PERSONAL", senderNickname: "민수", viewerIsSender: true });
    expect(status.rounds.map((round) => [round.sequence, round.viewable, round.confirmedCount, round.recipientCount])).toEqual([
      [1, true, 0, 2],
      [2, true, 1, 2],
    ]);
    expect(status.selection).toBe("SELECTED");
    expect(status.selected).toMatchObject({ sequence: 2, confirmedCount: 1, recipientCount: 2 });
    expect(status.selected!.recipients.map((row) => [row.nickname, row.confirmedAt !== null])).toEqual([
      ["유나", true],
      ["지수", false],
    ]);

    const first = visible(await getNotificationStatus(repositories, sender.id, notificationId, status.rounds[0]!.dispatchId));
    expect(first.selected).toMatchObject({ sequence: 1, confirmedCount: 0, recipientCount: 2 });
  });

  it("shows a recipient only their own row, and nothing to a third party", async () => {
    const { repositories, yuna, notificationId } = await personalRounds();
    const stranger = await createUser(repositories, "모르는 사람");

    const status = visible(await getNotificationStatus(repositories, yuna.id, notificationId));
    expect(status.notification.viewerIsSender).toBe(false);
    expect(status.rounds.every((round) => round.recipientCount === 1)).toBe(true);
    expect(status.selected!.recipients).toEqual([
      { recipientId: yuna.id, nickname: "유나", confirmedAt: null, isViewer: true },
    ]);
    expect(status.selected).toMatchObject({ confirmedCount: 0, recipientCount: 1 });

    expect(await getNotificationStatus(repositories, stranger.id, notificationId)).toEqual({ kind: "FORBIDDEN" });
    expect(await getNotificationStatus(repositories, stranger.id, randomUUID())).toEqual({ kind: "FORBIDDEN" });
    expect(await getNotificationStatus(repositories, stranger.id, "not-a-uuid")).toEqual({ kind: "FORBIDDEN" });
  });
});

describe("group response status", () => {
  it("applies the latest-membership boundary to every member, including the sender", async () => {
    const repositories = createRepositories();
    const mom = await createUser(repositories, "엄마");
    const dad = await createUser(repositories, "아빠");
    const latecomer = await createUser(repositories, "현우");
    const { group } = await createGroup(repositories, { actorId: mom.id, name: "우리 가족" });
    await acceptGroupInvite(repositories, { actorId: dad.id, groupId: group.id });
    const start = tomorrow();
    const notificationId = await reserve(repositories, mom.id, { groupId: group.id }, dailyAt21(start));

    expect(visible(await getNotificationStatus(repositories, mom.id, notificationId)).selection).toBe("NO_ROUNDS");

    await sendRound(repositories, start, 0);
    await acceptGroupInvite(repositories, { actorId: latecomer.id, groupId: group.id });
    await sendRound(repositories, start, 1);

    const late = visible(await getNotificationStatus(repositories, latecomer.id, notificationId));
    expect(late.rounds).toEqual([
      { dispatchId: expect.any(String), sequence: 1, effectiveDate: start.toISODate(), viewable: false },
      expect.objectContaining({ sequence: 2, viewable: true, recipientCount: 2 }),
    ]);
    expect(late.selected!.recipients.map((row) => [row.nickname, row.isViewer])).toEqual([
      ["아빠", false],
      ["현우", true],
    ]);

    // Directly requesting the round sent before joining returns no recipients or responses.
    const direct = visible(await getNotificationStatus(repositories, latecomer.id, notificationId, late.rounds[0]!.dispatchId));
    expect(direct.selection).toBe("UNAVAILABLE");
    expect(direct.selected).toBeNull();

    // The sender sees both rounds while a member, and loses access after leaving.
    expect(visible(await getNotificationStatus(repositories, mom.id, notificationId)).rounds.every((round) => round.viewable)).toBe(true);
    await leaveGroup(repositories, { actorId: mom.id, groupId: group.id, confirmation: true });
    expect(await getNotificationStatus(repositories, mom.id, notificationId)).toEqual({ kind: "FORBIDDEN" });

    // Rejoining starts a new visibility window: older rounds become unavailable.
    await acceptGroupInvite(repositories, { actorId: mom.id, groupId: group.id });
    const rejoined = visible(await getNotificationStatus(repositories, mom.id, notificationId));
    expect(rejoined.rounds.map((round) => round.viewable)).toEqual([false, false]);
    expect(rejoined.selection).toBe("UNAVAILABLE");
  });
});

describe("sent notifications and stopping", () => {
  it("lists one card per notification with the latest visible round and hides groups the sender left", async () => {
    const repositories = createRepositories();
    const sender = await createUser(repositories, "엄마");
    const friend = await createUser(repositories, "딸");
    const member = await createUser(repositories, "아빠");
    await addFriend(repositories, sender.id, { email: friend.email });
    const { group } = await createGroup(repositories, { actorId: sender.id, name: "우리 가족" });
    await acceptGroupInvite(repositories, { actorId: member.id, groupId: group.id });
    const start = tomorrow();

    expect(await getSentNotifications(repositories, sender.id)).toEqual([]);

    const personal = await reserve(repositories, sender.id, { recipientIds: [friend.id] }, dailyAt21(start));
    const grouped = await reserve(repositories, sender.id, { groupId: group.id }, {
      kind: "RECURRING",
      recurrence: "WEEKLY",
      startDate: start.toISODate(),
      localTime: "09:30",
      weekday: 6,
      skipWeekend: true,
    });
    await sendRound(repositories, start, 0);
    await sendRound(repositories, start, 1);
    const status = visible(await getNotificationStatus(repositories, sender.id, personal));
    await confirmDispatch(repositories, friend.id, status.selected!.dispatchId);

    const cards = await getSentNotifications(repositories, sender.id);
    expect(cards.map((card) => card.notificationId)).toEqual([grouped, personal]);
    expect(cards[1]).toMatchObject({
      mode: "PERSONAL",
      scheduleKind: "RECURRING",
      recurrence: "DAILY",
      localTime: "21:00:00",
      startDate: start.toISODate(),
      state: "ACTIVE",
      latestRound: { sequence: 2, recipientCount: 1, confirmedCount: 1 },
    });
    expect(cards[0]).toMatchObject({ mode: "GROUP", groupName: "우리 가족", weekday: 6, skipWeekend: true });

    await leaveGroup(repositories, { actorId: sender.id, groupId: group.id, confirmation: true });
    expect((await getSentNotifications(repositories, sender.id)).map((card) => card.notificationId)).toEqual([personal]);
  });

  it("stops only the sender's recurring notification, idempotently, and keeps past rounds", async () => {
    const repositories = createRepositories();
    const sender = await createUser(repositories, "민수");
    const friend = await createUser(repositories, "유나");
    await addFriend(repositories, sender.id, { email: friend.email });
    const start = tomorrow();
    const recurring = await reserve(repositories, sender.id, { recipientIds: [friend.id] }, dailyAt21(start));
    const oneTime = await reserve(repositories, sender.id, { recipientIds: [friend.id] }, {
      kind: "ONE_TIME",
      at: DateTime.now().plus({ days: 3 }).toUTC().toISO(),
    });
    await sendRound(repositories, start, 0);

    await expect(stopRecurringNotification(repositories, friend.id, recurring)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(stopRecurringNotification(repositories, sender.id, oneTime)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const first = await stopRecurringNotification(repositories, sender.id, recurring);
    const again = await stopRecurringNotification(repositories, sender.id, recurring);
    expect(again.stoppedAt).toEqual(first.stoppedAt);

    // The scheduler creates no new rounds after the stop; the first round stays.
    await sendRound(repositories, start, 1);
    await sendRound(repositories, start, 2);
    const status = visible(await getNotificationStatus(repositories, sender.id, recurring));
    expect(status.rounds.map((round) => round.sequence)).toEqual([1]);
    expect((await getSentNotifications(repositories, sender.id)).find((card) => card.notificationId === recurring)).toMatchObject({
      state: "STOPPED",
      latestRound: { sequence: 1 },
    });
  });
});
