import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applySqlMigrations,
  createIsolatedPostgresDatabase,
  createPostgresTestServer,
  type IsolatedPostgresDatabase,
  type PostgresTestServer,
} from "../database/postgres-test-database";

const INITIAL_SCHEMA_MIGRATION = resolve(
  process.cwd(),
  "prisma/migrations/20261114081236_auth_users_friends_groups_invites",
);
const NOTIFICATION_SCHEMA_MIGRATION = resolve(
  process.cwd(),
  "prisma/migrations/20261114081245_notification_delivery_schema",
);

let server: PostgresTestServer;

beforeAll(async () => {
  server = await createPostgresTestServer();
}, 120_000);

afterAll(async () => {
  await server.stop();
}, 120_000);

async function createUser(database: IsolatedPostgresDatabase, nickname: string) {
  const suffix = randomUUID();
  const result = await database.pool.query<{ id: string }>(
    `INSERT INTO "users" ("email", "email_normalized", "nickname", "updated_at")
     VALUES ($1, $2, $3, transaction_timestamp())
     RETURNING "id"`,
    [`${suffix}@example.test`, `${suffix}@example.test`, nickname],
  );

  return result.rows[0]!.id;
}

async function createPersonalNotification(
  database: IsolatedPostgresDatabase,
  senderId: string,
) {
  const result = await database.pool.query<{ id: string }>(
    `INSERT INTO "notification" (
       "sender_id", "sentence", "mode", "schedule_kind", "one_time_at"
     ) VALUES ($1, $2, 'PERSONAL', 'ONE_TIME', $3)
     RETURNING "id"`,
    [senderId, "제약 검증 알림", "2026-02-03T04:05:06.000Z"],
  );

  return result.rows[0]!.id;
}

async function createClaim(
  database: IsolatedPostgresDatabase,
  notificationId: string,
  effectiveDate: string,
) {
  const result = await database.pool.query<{ id: string }>(
    `INSERT INTO "schedule_claim" (
       "notification_id", "effective_date", "source_dates", "state"
     ) VALUES ($1, $2::date, ARRAY[$2::date], 'SENT')
     RETURNING "id"`,
    [notificationId, effectiveDate],
  );

  return result.rows[0]!.id;
}

describe("notification delivery schema migration", () => {
  it("applies every migration to an empty PostgreSQL database", async () => {
    const database = await createIsolatedPostgresDatabase(server);

    try {
      const tables = await database.pool.query<{ table_name: string }>(
        `SELECT "table_name"
         FROM "information_schema"."tables"
         WHERE "table_schema" = 'public'
           AND "table_name" IN (
             'users', 'friends', 'memberships', 'notification', 'schedule_claim',
             'dispatch', 'dispatch_recipient'
           )
         ORDER BY "table_name"`,
      );

      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "dispatch",
        "dispatch_recipient",
        "friends",
        "memberships",
        "notification",
        "schedule_claim",
        "users",
      ]);
    } finally {
      await database.dispose();
    }
  }, 120_000);

  it("adds notification constraints after the prior schema and rolls back invalid writes", async () => {
    const database = await createIsolatedPostgresDatabase(server, {
      migrationDirectories: [INITIAL_SCHEMA_MIGRATION],
    });

    try {
      await expect(
        database.pool.query("SELECT to_regclass('public.notification') AS relation"),
      ).resolves.toMatchObject({ rows: [{ relation: null }] });

      await applySqlMigrations(database.pool, [NOTIFICATION_SCHEMA_MIGRATION]);

      const ownerId = await createUser(database, "발신자");
      const friendId = await createUser(database, "친구");
      const memberId = await createUser(database, "구성원");
      const group = await database.pool.query<{ id: string }>(
        `INSERT INTO "groups" ("name", "created_by_id")
         VALUES ('제약 그룹', $1)
         RETURNING "id"`,
        [ownerId],
      );
      const groupId = group.rows[0]!.id;
      const ownerEmail = await database.pool.query<{ email_normalized: string }>(
        `SELECT "email_normalized" FROM "users" WHERE "id" = $1`,
        [ownerId],
      );

      await expect(
        database.pool.query(
          `INSERT INTO "users" ("email", "email_normalized", "nickname", "updated_at")
           VALUES ($1, $2, '중복 이메일', transaction_timestamp())`,
          ["other@example.test", ownerEmail.rows[0]!.email_normalized],
        ),
      ).rejects.toMatchObject({ code: "23505" });

      await database.pool.query(
        `INSERT INTO "friends" ("owner_id", "friend_id") VALUES ($1, $2)`,
        [ownerId, friendId],
      );
      await expect(
        database.pool.query(
          `INSERT INTO "friends" ("owner_id", "friend_id") VALUES ($1, $2)`,
          [ownerId, friendId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        database.pool.query(
          `INSERT INTO "friends" ("owner_id", "friend_id") VALUES ($1, $1)`,
          [ownerId],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      const membership = await database.pool.query<{ id: string }>(
        `INSERT INTO "memberships" ("group_id", "user_id")
         VALUES ($1, $2)
         RETURNING "id"`,
        [groupId, memberId],
      );
      await expect(
        database.pool.query(
          `INSERT INTO "memberships" ("group_id", "user_id") VALUES ($1, $2)`,
          [groupId, memberId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await database.pool.query(
        `UPDATE "memberships" SET "left_at" = transaction_timestamp() WHERE "id" = $1`,
        [membership.rows[0]!.id],
      );
      await database.pool.query(
        `INSERT INTO "memberships" ("group_id", "user_id") VALUES ($1, $2)`,
        [groupId, memberId],
      );

      await expect(
        database.pool.query(
          `INSERT INTO "notification" (
             "sender_id", "sentence", "mode", "group_id", "schedule_kind", "one_time_at"
           ) VALUES ($1, '잘못된 개인 대상', 'PERSONAL', $2, 'ONE_TIME', transaction_timestamp())`,
          [ownerId, groupId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        database.pool.query(
          `INSERT INTO "notification" (
             "sender_id", "sentence", "mode", "schedule_kind", "one_time_at"
           ) VALUES ($1, '그룹 없는 그룹 대상', 'GROUP', 'ONE_TIME', transaction_timestamp())`,
          [ownerId],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      const notificationId = await createPersonalNotification(database, ownerId);
      const firstClaimId = await createClaim(database, notificationId, "2026-02-03");
      await expect(createClaim(database, notificationId, "2026-02-03")).rejects.toMatchObject({
        code: "23505",
      });

      await database.pool.query(
        `INSERT INTO "dispatch" (
           "notification_id", "claim_id", "sequence", "scheduled_date", "effective_date", "sent_at"
         ) VALUES ($1, $2, 1, '2026-02-03', '2026-02-03', transaction_timestamp())`,
        [notificationId, firstClaimId],
      );
      const secondClaimId = await createClaim(database, notificationId, "2026-02-04");
      await expect(
        database.pool.query(
          `INSERT INTO "dispatch" (
             "notification_id", "claim_id", "sequence", "scheduled_date", "effective_date", "sent_at"
           ) VALUES ($1, $2, 1, '2026-02-04', '2026-02-04', transaction_timestamp())`,
          [notificationId, secondClaimId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        database.pool.query(
          `INSERT INTO "dispatch" (
             "notification_id", "claim_id", "sequence", "scheduled_date", "effective_date", "sent_at"
           ) VALUES ($1, $2, 2, '2026-02-04', '2026-02-03', transaction_timestamp())`,
          [notificationId, secondClaimId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        database.pool.query(
          `INSERT INTO "dispatch" (
             "notification_id", "claim_id", "sequence", "scheduled_date", "effective_date", "sent_at"
           ) VALUES ($1, $2, 2, '2026-02-04', '2026-02-04', transaction_timestamp())`,
          [notificationId, firstClaimId],
        ),
      ).rejects.toMatchObject({ code: "23505" });

      const dispatch = await database.pool.query<{ id: string }>(
        `SELECT "id" FROM "dispatch" WHERE "claim_id" = $1`,
        [firstClaimId],
      );
      await database.pool.query(
        `INSERT INTO "dispatch_recipient" (
           "dispatch_id", "recipient_id", "recipient_nickname_snapshot"
         ) VALUES ($1, $2, '친구')`,
        [dispatch.rows[0]!.id, friendId],
      );
      await expect(
        database.pool.query(
          `INSERT INTO "dispatch_recipient" (
             "dispatch_id", "recipient_id", "recipient_nickname_snapshot"
           ) VALUES ($1, $2, '친구')`,
          [dispatch.rows[0]!.id, friendId],
        ),
      ).rejects.toMatchObject({ code: "23505" });

      const client = await database.pool.connect();
      const rollbackSentence = "롤백되어야 하는 알림";
      try {
        await client.query("BEGIN");
        const pending = await client.query<{ id: string }>(
          `INSERT INTO "notification" (
             "sender_id", "sentence", "mode", "schedule_kind", "one_time_at"
           ) VALUES ($1, $2, 'PERSONAL', 'ONE_TIME', transaction_timestamp())
           RETURNING "id"`,
          [ownerId, rollbackSentence],
        );
        await expect(
          client.query(
            `INSERT INTO "personal_target" ("notification_id", "user_id")
             VALUES ($1, $2), ($1, $2)`,
            [pending.rows[0]!.id, friendId],
          ),
        ).rejects.toMatchObject({ code: "23505" });
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }

      const rollbackRows = await database.pool.query<{ notification_count: string; target_count: string }>(
        `SELECT
           (SELECT count(*) FROM "notification" WHERE "sentence" = $1) AS "notification_count",
           (SELECT count(*) FROM "personal_target") AS "target_count"`,
        [rollbackSentence],
      );
      expect(rollbackRows.rows[0]).toEqual({ notification_count: "0", target_count: "0" });
    } finally {
      await database.dispose();
    }
  }, 120_000);
});
