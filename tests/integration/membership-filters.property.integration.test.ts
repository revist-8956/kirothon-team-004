import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";

import { processDueSlot } from "@/application/dispatch-scheduler";
import { acceptGroupInvite, createGroup, leaveGroup } from "@/application/group-memberships";
import { getInbox } from "@/application/inbox";
import { getSentNotifications } from "@/application/notification-status";
import { toNotificationScheduleFields } from "@/application/notification-reservations";
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

afterAll(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
});

const schedule = toNotificationScheduleFields({
  kind: "RECURRING",
  recurrence: "DAILY",
  startDate: "2026-03-01",
  localTime: "09:00",
  skipWeekend: false,
  timezone: "Asia/Seoul",
});

type Event = "join" | "leave" | "send";

/** Applies a membership/dispatch history for one viewer and returns their latest membership. */
async function playHistory(events: readonly Event[]) {
  const repositories = createRepositories();
  const user = (nickname: string) =>
    createSupabaseProfileUser(fixture.current.pool, repositories, { email: `${randomUUID()}@example.test`, nickname });
  const sender = await user("엄마");
  const other = await user("아빠");
  const viewer = await user("현우");
  const { group } = await createGroup(repositories, { actorId: sender.id, name: "우리 가족" });
  await acceptGroupInvite(repositories, { actorId: other.id, groupId: group.id });
  const notification = await repositories.transaction((transaction) =>
    transaction.notifications.create({ senderId: sender.id, sentence: "약", mode: "GROUP", groupId: group.id, ...schedule }),
  );
  let member = false;
  let day = 1;

  for (const event of events) {
    if (event === "join" && !member) {
      await acceptGroupInvite(repositories, { actorId: viewer.id, groupId: group.id });
      member = true;
    } else if (event === "leave" && member) {
      await leaveGroup(repositories, { actorId: viewer.id, groupId: group.id, confirmation: true });
      member = false;
    } else if (event === "send") {
      const effectiveDate = `2026-04-${String(day).padStart(2, "0")}`;
      day += 1;
      await processDueSlot(repositories, {
        notificationId: notification.id,
        slot: { effectiveDate, sourceDates: [effectiveDate], dueAtUtc: new Date(`${effectiveDate}T00:00:00.000Z`) },
      });
    }
  }

  const latest = await fixture.current.pool.query<{ joined_at: Date }>(
    `SELECT "joined_at" FROM "memberships"
     WHERE "group_id" = $1 AND "user_id" = $2 AND "left_at" IS NULL
     ORDER BY "joined_at" DESC LIMIT 1`,
    [group.id, viewer.id],
  );
  return { repositories, sender, viewer, group, notificationId: notification.id, latestJoin: latest.rows[0]?.joined_at };
}

const historyArbitrary = fc.array(fc.constantFrom<Event>("join", "leave", "send"), { minLength: 1, maxLength: 8 });

describe("membership-based list filters against PostgreSQL", () => {
  // Feature: personal-group-notifications, Property 19: 외부 사용자의 받은 그룹 카드 제외
  // **Validates: Requirements 12.11**
  it("Property 19: the inbox shows a group card only to a current member who joined by its send time", async () => {
    await fc.assert(
      fc.asyncProperty(historyArbitrary, async (events) => {
        const { repositories, viewer, notificationId, latestJoin } = await playHistory(events);
        const received = await fixture.current.pool.query<{ dispatch_id: string; sent_at: Date }>(
          `SELECT r."dispatch_id", d."sent_at"
           FROM "dispatch_recipient" r JOIN "dispatch" d ON d."id" = r."dispatch_id"
           WHERE r."recipient_id" = $1 AND d."notification_id" = $2`,
          [viewer.id, notificationId],
        );
        const expected = received.rows
          .filter((row) => latestJoin !== undefined && row.sent_at.getTime() >= latestJoin.getTime())
          .map((row) => row.dispatch_id)
          .sort();

        const inbox = await getInbox(repositories, viewer.id);
        expect(inbox.cards.map((card) => card.dispatchId).sort()).toEqual(expected);
        if (latestJoin === undefined) {
          expect(inbox.cards).toEqual([]);
        }
      }),
      { numRuns: 20 },
    );
  }, 120_000);

  // Feature: personal-group-notifications, Property 25: 보낸 그룹 알림 목록의 현재 멤버십 필터
  // **Validates: Requirements 17.4**
  it("Property 25: sent personal notifications always appear; group ones only while the sender is a member", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ mode: fc.constantFrom<"PERSONAL" | "GROUP">("PERSONAL", "GROUP"), leaveAfter: fc.boolean() }), {
          minLength: 1,
          maxLength: 5,
        }),
        async (plans) => {
          const repositories = createRepositories();
          const sender = await createSupabaseProfileUser(fixture.current.pool, repositories, {
            email: `${randomUUID()}@example.test`,
            nickname: "엄마",
          });
          const expected: string[] = [];

          for (const plan of plans) {
            if (plan.mode === "PERSONAL") {
              const notification = await repositories.transaction((transaction) =>
                transaction.notifications.create({ senderId: sender.id, sentence: "약", mode: "PERSONAL", groupId: null, ...schedule }),
              );
              expected.push(notification.id);
              continue;
            }
            const { group } = await createGroup(repositories, { actorId: sender.id, name: "그룹" });
            const notification = await repositories.transaction((transaction) =>
              transaction.notifications.create({ senderId: sender.id, sentence: "약", mode: "GROUP", groupId: group.id, ...schedule }),
            );
            if (plan.leaveAfter) {
              await leaveGroup(repositories, { actorId: sender.id, groupId: group.id, confirmation: true });
            } else {
              expected.push(notification.id);
            }
          }

          const sent = await getSentNotifications(repositories, sender.id);
          expect(sent.map((card) => card.notificationId).sort()).toEqual(expected.sort());
        },
      ),
      { numRuns: 20 },
    );
  }, 120_000);
});
