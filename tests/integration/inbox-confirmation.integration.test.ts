import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import { afterEach, describe, expect, it } from "vitest";

import { runSchedulerTick } from "@/application/dispatch-scheduler";
import { addFriend } from "@/application/friends";
import { acceptGroupInvite, createGroup, leaveGroup } from "@/application/group-memberships";
import { confirmDispatch, getInbox } from "@/application/inbox";
import { createNotificationDraft } from "@/application/notification-drafts";
import { scheduleNotification } from "@/application/notification-reservations";
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
  sentence: string,
  target: { recipientIds: string[] } | { groupId: string },
  schedule: Record<string, unknown>,
) {
  const draft = await createNotificationDraft(repositories, senderId, {
    sentence,
    ...("groupId" in target ? { mode: "GROUP", groupId: target.groupId } : { mode: "PERSONAL", ...target }),
  });
  return (await scheduleNotification(repositories, senderId, { draftId: draft.id, schedule })).notificationId;
}

async function responses() {
  const result = await fixture.current.pool.query<{ recipient_id: string; confirmed_at: Date | null }>(
    `SELECT "recipient_id", "confirmed_at" FROM "dispatch_recipient" ORDER BY "recipient_id", "dispatch_id"`,
  );
  return result.rows;
}

/** Mom's family group with a daily 21:00 notification sent for two days. */
async function familyWithTwoRounds() {
  const repositories = createRepositories();
  const mom = await createUser(repositories, "엄마");
  const dad = await createUser(repositories, "아빠");
  const daughter = await createUser(repositories, "딸");
  const { group } = await createGroup(repositories, { actorId: mom.id, name: "우리 가족" });
  await acceptGroupInvite(repositories, { actorId: dad.id, groupId: group.id });
  await acceptGroupInvite(repositories, { actorId: daughter.id, groupId: group.id });
  const start = DateTime.now().setZone(SCHEDULE_TIMEZONE).plus({ days: 1 });
  await reserve(repositories, mom.id, "저녁 약 챙겨 먹기", { groupId: group.id }, {
    kind: "RECURRING",
    recurrence: "DAILY",
    startDate: start.toISODate(),
    localTime: "21:00",
    skipWeekend: false,
  });
  await runSchedulerTick(repositories, tickOptions, start.plus({ days: 1 }).set({ hour: 21, minute: 1 }).toJSDate());
  return { repositories, mom, dad, daughter, group };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
});

describe("inbox and explicit confirmation against isolated PostgreSQL", () => {
  it("shows one card per round with only the viewer's response, and reading changes nothing", async () => {
    const { repositories, mom, daughter } = await familyWithTwoRounds();
    const before = await responses();

    const inbox = await getInbox(repositories, daughter.id);
    await getInbox(repositories, daughter.id);

    expect(inbox.unconfirmedCount).toBe(2);
    expect(inbox.cards.map((card) => [card.sentence, card.mode, card.groupName, card.senderNickname, card.sequence])).toEqual([
      ["저녁 약 챙겨 먹기", "GROUP", "우리 가족", "엄마", 2],
      ["저녁 약 챙겨 먹기", "GROUP", "우리 가족", "엄마", 1],
    ]);
    expect(inbox.cards.every((card) => card.confirmedAt === null && card.recurrence === "DAILY")).toBe(true);
    expect((await getInbox(repositories, mom.id)).cards).toEqual([]);
    expect(await responses()).toEqual(before);
  });

  it("stores the first confirmation time once and returns it on repeated requests", async () => {
    const { repositories, dad, daughter } = await familyWithTwoRounds();
    const [latest, earlier] = (await getInbox(repositories, daughter.id)).cards;

    const first = await confirmDispatch(repositories, daughter.id, latest!.dispatchId);
    const again = await confirmDispatch(repositories, daughter.id, latest!.dispatchId);

    expect(first.firstConfirmation).toBe(true);
    expect(again).toEqual({ ...first, firstConfirmation: false });
    const inbox = await getInbox(repositories, daughter.id);
    expect(inbox.unconfirmedCount).toBe(1);
    expect(inbox.cards.find((card) => card.dispatchId === latest!.dispatchId)?.confirmedAt).toEqual(first.confirmedAt);
    // Other rounds and other recipients are untouched.
    expect(inbox.cards.find((card) => card.dispatchId === earlier!.dispatchId)?.confirmedAt).toBeNull();
    expect((await getInbox(repositories, dad.id)).unconfirmedCount).toBe(2);
  });

  it("rejects a non-recipient without changing any response", async () => {
    const { repositories, mom, daughter } = await familyWithTwoRounds();
    const stranger = await createUser(repositories, "모르는 사람");
    const [card] = (await getInbox(repositories, daughter.id)).cards;
    const before = await responses();

    for (const actor of [stranger.id, mom.id]) {
      await expect(confirmDispatch(repositories, actor, card!.dispatchId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(confirmDispatch(repositories, daughter.id, "not-a-uuid")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await responses()).toEqual(before);
  });

  it("hides group cards from a member who left and rejects their confirmation", async () => {
    const { repositories, dad, group } = await familyWithTwoRounds();
    const [card] = (await getInbox(repositories, dad.id)).cards;
    await leaveGroup(repositories, { actorId: dad.id, groupId: group.id, confirmation: true });
    const before = await responses();

    expect(await getInbox(repositories, dad.id)).toEqual({ cards: [], unconfirmedCount: 0 });
    await expect(confirmDispatch(repositories, dad.id, card!.dispatchId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await responses()).toEqual(before);

    // Rejoining does not reopen rounds sent before the new membership began.
    await acceptGroupInvite(repositories, { actorId: dad.id, groupId: group.id });
    expect((await getInbox(repositories, dad.id)).cards).toEqual([]);
    await expect(confirmDispatch(repositories, dad.id, card!.dispatchId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps personal cards visible regardless of group membership", async () => {
    const repositories = createRepositories();
    const sender = await createUser(repositories, "민수");
    const friend = await createUser(repositories, "태호");
    await addFriend(repositories, sender.id, { email: friend.email });
    const at = DateTime.now().plus({ hours: 1 }).startOf("minute").toUTC();
    await reserve(repositories, sender.id, "점심 메뉴 투표해 주세요", { recipientIds: [friend.id] }, {
      kind: "ONE_TIME",
      at: at.toISO(),
    });
    await runSchedulerTick(repositories, tickOptions, at.toJSDate());

    const inbox = await getInbox(repositories, friend.id);
    expect(inbox.cards).toMatchObject([
      { sentence: "점심 메뉴 투표해 주세요", mode: "PERSONAL", groupName: null, scheduleKind: "ONE_TIME" },
    ]);
    await expect(confirmDispatch(repositories, friend.id, inbox.cards[0]!.dispatchId)).resolves.toMatchObject({
      firstConfirmation: true,
    });
  });

  it("serializes a confirmation racing with leaving the group", async () => {
    const { repositories, daughter, group } = await familyWithTwoRounds();
    const otherConnection = createRepositories();
    const [card] = (await getInbox(repositories, daughter.id)).cards;

    const [confirmation, leaving] = await Promise.allSettled([
      confirmDispatch(repositories, daughter.id, card!.dispatchId),
      leaveGroup(otherConnection, { actorId: daughter.id, groupId: group.id, confirmation: true }),
    ]);

    expect(leaving.status).toBe("fulfilled");
    const stored = (await responses()).filter((row) => row.recipient_id === daughter.id);
    if (confirmation.status === "fulfilled") {
      // Confirm committed first: the first confirmation is kept after leaving.
      expect(stored.some((row) => row.confirmed_at?.getTime() === confirmation.value.confirmedAt.getTime())).toBe(true);
    } else {
      // Leave committed first: the confirmation was refused and nothing changed.
      expect(confirmation.reason).toMatchObject({ code: "FORBIDDEN" });
      expect(stored.every((row) => row.confirmed_at === null)).toBe(true);
    }
  });
});
