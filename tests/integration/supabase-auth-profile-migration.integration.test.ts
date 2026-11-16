import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isValidNickname, normalizeNickname } from "@/domain/nickname";
import {
  applySqlMigrations,
  createIsolatedPostgresDatabase,
  createPostgresTestServer,
  type IsolatedPostgresDatabase,
  type PostgresTestServer,
} from "../database/postgres-test-database";
import { createSupabaseAuthUser } from "../database/supabase-auth-schema";

const MIGRATIONS = resolve(process.cwd(), "prisma/migrations");
const AUTH_JS_SCHEMA_MIGRATIONS = [
  resolve(MIGRATIONS, "20261114081236_auth_users_friends_groups_invites"),
  resolve(MIGRATIONS, "20261114081245_notification_delivery_schema"),
];
const SUPABASE_PROFILE_MIGRATION = resolve(
  MIGRATIONS,
  "20261114120000_supabase_auth_user_profiles",
);

let server: PostgresTestServer;

beforeAll(async () => {
  server = await createPostgresTestServer();
}, 120_000);

afterAll(async () => {
  await server.stop();
}, 120_000);

async function withDatabase(
  options: Parameters<typeof createIsolatedPostgresDatabase>[1],
  work: (database: IsolatedPostgresDatabase) => Promise<void>,
) {
  const database = await createIsolatedPostgresDatabase(server, options);
  try {
    await work(database);
  } finally {
    await database.dispose();
  }
}

async function profileOf(database: IsolatedPostgresDatabase, id: string) {
  const result = await database.pool.query<{
    email: string;
    email_normalized: string;
    nickname: string;
    nickname_required: boolean;
  }>(
    `SELECT "email", "email_normalized", "nickname", "nickname_required"
     FROM "users" WHERE "id" = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

async function insertLegacyUser(database: IsolatedPostgresDatabase, email: string, nickname: string) {
  const result = await database.pool.query<{ id: string }>(
    `INSERT INTO "users" ("email", "email_normalized", "name", "image", "nickname", "updated_at")
     VALUES ($1, lower($1), $2, 'https://example.test/avatar.png', $2, transaction_timestamp())
     RETURNING "id"`,
    [email, nickname],
  );
  return result.rows[0]!.id;
}

function migrationError(error: unknown): { message?: string; detail?: string; code?: string } {
  return (error as { cause?: { message?: string; detail?: string; code?: string } }).cause ?? {};
}

describe("Supabase auth.users profile migration", () => {
  it("creates Google profiles for new Supabase users with the application nickname and email rules", async () => {
    await withDatabase({}, async (database) => {
      const legacyTables = await database.pool.query<{ accounts: string | null; sessions: string | null; tokens: string | null }>(
        `SELECT to_regclass('public.accounts')::text AS "accounts",
                to_regclass('public.sessions')::text AS "sessions",
                to_regclass('public.verification_tokens')::text AS "tokens"`,
      );
      expect(legacyTables.rows[0]).toEqual({ accounts: null, sessions: null, tokens: null });

      const columns = await database.pool.query<{ column_name: string; column_default: string | null }>(
        `SELECT "column_name", "column_default" FROM "information_schema"."columns"
         WHERE "table_schema" = 'public' AND "table_name" = 'users' ORDER BY "ordinal_position"`,
      );
      expect(columns.rows.map((column) => column.column_name)).toEqual([
        "id", "email", "email_normalized", "nickname", "nickname_required", "created_at", "updated_at",
      ]);
      expect(columns.rows.find((column) => column.column_name === "id")?.column_default).toBeNull();

      const id = await createSupabaseAuthUser(database.pool, {
        email: "Member@Example.COM",
        fullName: "  민수  ",
      });
      expect(await profileOf(database, id)).toEqual({
        email: "Member@Example.COM",
        email_normalized: "member@example.com",
        nickname: "민수",
        nickname_required: false,
      });

      const nameOnly = await createSupabaseAuthUser(database.pool, {
        email: `${randomUUID()}@example.test`,
        userMetadata: { name: "지은" },
      });
      expect(await profileOf(database, nameOnly)).toMatchObject({ nickname: "지은", nickname_required: false });

      for (const googleName of ["\u3000서연\u00A0", "😀".repeat(20), "😀".repeat(21), "\t \n", "가 나"]) {
        const userId = await createSupabaseAuthUser(database.pool, {
          email: `${randomUUID()}@example.test`,
          fullName: googleName,
        });
        expect(await profileOf(database, userId)).toMatchObject({
          nickname: normalizeNickname(googleName),
          nickname_required: !isValidNickname(googleName),
        });
      }

      const withoutName = await createSupabaseAuthUser(database.pool, {
        email: `${randomUUID()}@example.test`,
      });
      expect(await profileOf(database, withoutName)).toMatchObject({ nickname: "", nickname_required: true });
    });
  }, 120_000);

  it("never blocks Supabase sign-up and keeps the profile id, email, and history constraints", async () => {
    await withDatabase({}, async (database) => {
      const ownerId = await createSupabaseAuthUser(database.pool, {
        email: "owner@example.com",
        fullName: "소유자",
      });

      const sameNormalizedEmail = await createSupabaseAuthUser(database.pool, {
        email: "OWNER@example.com",
        fullName: "중복",
      });
      const withoutEmail = await createSupabaseAuthUser(database.pool, { email: null, fullName: "이메일 없음" });
      const invalidEmail = await createSupabaseAuthUser(database.pool, { email: "not-an-email", fullName: "형식 오류" });
      expect(await profileOf(database, sameNormalizedEmail)).toBeNull();
      expect(await profileOf(database, withoutEmail)).toBeNull();
      expect(await profileOf(database, invalidEmail)).toBeNull();

      await expect(
        database.pool.query(
          `INSERT INTO "users" ("id", "email", "email_normalized", "nickname")
           VALUES ($1, 'orphan@example.com', 'orphan@example.com', '고아')`,
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        database.pool.query(
          `INSERT INTO "users" ("id", "email", "email_normalized", "nickname")
           VALUES ($1, 'Owner@Example.com', 'owner@example.com', '중복')`,
          [sameNormalizedEmail],
        ),
      ).rejects.toMatchObject({ code: "23505" });

      const friendId = await createSupabaseAuthUser(database.pool, {
        email: "friend@example.com",
        fullName: "친구",
      });
      await database.pool.query(
        `INSERT INTO "friends" ("owner_id", "friend_id") VALUES ($1, $2)`,
        [ownerId, friendId],
      );
      await database.pool.query(`DELETE FROM auth.users WHERE "id" = $1`, [friendId]);
      expect(await profileOf(database, friendId)).toBeNull();

      await database.pool.query(
        `INSERT INTO "groups" ("name", "created_by_id") VALUES ('기록 그룹', $1)`,
        [ownerId],
      );
      await expect(
        database.pool.query(`DELETE FROM auth.users WHERE "id" = $1`, [ownerId]),
      ).rejects.toMatchObject({ code: "23503" });
      expect(await profileOf(database, ownerId)).toMatchObject({ nickname: "소유자" });
    });
  }, 120_000);

  it("maps deployed Auth.js profiles to Supabase users by normalized email and drops legacy tables", async () => {
    await withDatabase({ migrationDirectories: AUTH_JS_SCHEMA_MIGRATIONS }, async (database) => {
      const { pool } = database;
      const aliceLegacyId = await insertLegacyUser(database, "Alice@Example.com", "앨리스");
      const bobLegacyId = await insertLegacyUser(database, "bob@example.com", "밥");

      await pool.query(
        `INSERT INTO "accounts" ("user_id", "type", "provider", "provider_account_id", "access_token", "refresh_token", "id_token")
         VALUES ($1, 'oidc', 'google', 'google-alice', 'legacy-access-token', 'legacy-refresh-token', 'legacy-id-token')`,
        [aliceLegacyId],
      );
      await pool.query(
        `INSERT INTO "sessions" ("session_token", "user_id", "expires")
         VALUES ('legacy-session-token', $1, transaction_timestamp() + interval '1 day')`,
        [aliceLegacyId],
      );
      await pool.query(`INSERT INTO "friends" ("owner_id", "friend_id") VALUES ($1, $2)`, [aliceLegacyId, bobLegacyId]);
      const group = await pool.query<{ id: string }>(
        `INSERT INTO "groups" ("name", "created_by_id") VALUES ('운영팀', $1) RETURNING "id"`,
        [aliceLegacyId],
      );
      const groupId = group.rows[0]!.id;
      await pool.query(
        `INSERT INTO "memberships" ("group_id", "user_id", "email_visibility")
         VALUES ($1, $2, 'PRIVATE'), ($1, $3, 'PUBLIC')`,
        [groupId, aliceLegacyId, bobLegacyId],
      );
      await pool.query(
        `INSERT INTO "invites" ("group_id", "issued_by_id", "token_hash") VALUES ($1, $2, repeat('a', 64))`,
        [groupId, aliceLegacyId],
      );
      const notification = await pool.query<{ id: string }>(
        `INSERT INTO "notification" ("sender_id", "sentence", "mode", "schedule_kind", "one_time_at")
         VALUES ($1, '회의 확인', 'PERSONAL', 'ONE_TIME', transaction_timestamp()) RETURNING "id"`,
        [aliceLegacyId],
      );
      const notificationId = notification.rows[0]!.id;
      await pool.query(
        `INSERT INTO "personal_target" ("notification_id", "user_id") VALUES ($1, $2)`,
        [notificationId, bobLegacyId],
      );
      await pool.query(
        `INSERT INTO "notification_draft" ("owner_id", "sentence", "mode", "target_json", "expires_at")
         VALUES ($1, '초안', 'PERSONAL', $2::jsonb, transaction_timestamp() + interval '30 minutes')`,
        [aliceLegacyId, JSON.stringify({ recipientIds: [bobLegacyId] })],
      );
      const claim = await pool.query<{ id: string }>(
        `INSERT INTO "schedule_claim" ("notification_id", "effective_date", "source_dates", "state")
         VALUES ($1, '2026-02-03', ARRAY['2026-02-03'::date], 'SENT') RETURNING "id"`,
        [notificationId],
      );
      const dispatch = await pool.query<{ id: string }>(
        `INSERT INTO "dispatch" ("notification_id", "claim_id", "sequence", "scheduled_date", "effective_date", "sent_at")
         VALUES ($1, $2, 1, '2026-02-03', '2026-02-03', transaction_timestamp()) RETURNING "id"`,
        [notificationId, claim.rows[0]!.id],
      );
      await pool.query(
        `INSERT INTO "dispatch_recipient" ("dispatch_id", "recipient_id", "recipient_nickname_snapshot")
         VALUES ($1, $2, '밥')`,
        [dispatch.rows[0]!.id, bobLegacyId],
      );

      // Supabase Auth users for the same people, plus one who never used Auth.js.
      const aliceId = await createSupabaseAuthUser(pool, { email: "alice@example.com", fullName: "Alice Google" });
      const bobId = await createSupabaseAuthUser(pool, { email: "bob@example.com", fullName: "Bob Google" });
      const carolId = await createSupabaseAuthUser(pool, { email: "carol@example.com", fullName: "캐럴" });

      await applySqlMigrations(pool, [SUPABASE_PROFILE_MIGRATION]);

      expect(await profileOf(database, aliceId)).toEqual({
        email: "Alice@Example.com",
        email_normalized: "alice@example.com",
        nickname: "앨리스",
        nickname_required: false,
      });
      expect(await profileOf(database, bobId)).toMatchObject({ nickname: "밥" });
      expect(await profileOf(database, carolId)).toMatchObject({ nickname: "캐럴", nickname_required: false });
      expect(await profileOf(database, aliceLegacyId)).toBeNull();
      expect(await profileOf(database, bobLegacyId)).toBeNull();

      const references = await pool.query(
        `SELECT
           (SELECT row_to_json(f) FROM (SELECT "owner_id", "friend_id" FROM "friends") f) AS "friend",
           (SELECT "created_by_id" FROM "groups") AS "group_creator",
           (SELECT json_agg(json_build_object('user_id', "user_id", 'email_visibility', "email_visibility") ORDER BY "email_visibility")
              FROM "memberships") AS "memberships",
           (SELECT "issued_by_id" FROM "invites") AS "invite_issuer",
           (SELECT "sender_id" FROM "notification") AS "sender",
           (SELECT "user_id" FROM "personal_target") AS "personal_target",
           (SELECT json_build_object('owner_id', "owner_id", 'target_json', "target_json") FROM "notification_draft") AS "draft",
           (SELECT "recipient_id" FROM "dispatch_recipient") AS "dispatch_recipient"`,
      );
      expect(references.rows[0]).toEqual({
        friend: { owner_id: aliceId, friend_id: bobId },
        group_creator: aliceId,
        memberships: [
          { user_id: aliceId, email_visibility: "PRIVATE" },
          { user_id: bobId, email_visibility: "PUBLIC" },
        ],
        invite_issuer: aliceId,
        sender: aliceId,
        personal_target: bobId,
        draft: { owner_id: aliceId, target_json: { recipientIds: [bobId] } },
        dispatch_recipient: bobId,
      });

      const tokenColumns = await pool.query<{ table_name: string; column_name: string }>(
        `SELECT "table_name", "column_name" FROM "information_schema"."columns"
         WHERE "table_schema" = 'public' AND "column_name" LIKE '%token%'
         ORDER BY "table_name", "column_name"`,
      );
      expect(tokenColumns.rows).toEqual([{ table_name: "invites", column_name: "token_hash" }]);
      const legacyTables = await pool.query<{ relation: string | null }>(
        `SELECT unnest(ARRAY[
           to_regclass('public.accounts'), to_regclass('public.sessions'), to_regclass('public.verification_tokens')
         ])::text AS "relation"`,
      );
      expect(legacyTables.rows).toEqual([{ relation: null }, { relation: null }, { relation: null }]);
    });
  }, 120_000);

  it("stops without deleting or changing anything when a legacy profile has no Supabase user", async () => {
    await withDatabase({ migrationDirectories: AUTH_JS_SCHEMA_MIGRATIONS }, async (database) => {
      const mappedLegacyId = await insertLegacyUser(database, "mapped@example.com", "연결됨");
      const unmappedLegacyId = await insertLegacyUser(database, "unmapped@example.com", "연결 안 됨");
      await database.pool.query(
        `INSERT INTO "accounts" ("user_id", "type", "provider", "provider_account_id")
         VALUES ($1, 'oidc', 'google', 'google-unmapped')`,
        [unmappedLegacyId],
      );
      await createSupabaseAuthUser(database.pool, { email: "mapped@example.com", fullName: "연결됨" });

      const failure = await applySqlMigrations(database.pool, [SUPABASE_PROFILE_MIGRATION]).catch(
        (error: unknown) => error,
      );

      expect(migrationError(failure)).toMatchObject({
        code: "23503",
        message: "Legacy profiles without a matching Supabase auth.users email: 1",
        detail: `Unmapped public.users ids: ${unmappedLegacyId}`,
      });
      const profiles = await database.pool.query<{ id: string }>(`SELECT "id" FROM "users" ORDER BY "email"`);
      expect(profiles.rows).toEqual([{ id: mappedLegacyId }, { id: unmappedLegacyId }]);
      const accounts = await database.pool.query<{ count: string }>(`SELECT count(*) FROM "accounts"`);
      expect(accounts.rows[0]?.count).toBe("1");
    });
  }, 120_000);

  it("refuses to run where Supabase does not own an auth.users table", async () => {
    const failure = await createIsolatedPostgresDatabase(server, { supabaseAuthSchema: false }).catch(
      (error: unknown) => error,
    );

    expect(migrationError(failure)).toMatchObject({
      code: "42P01",
      message: "Supabase auth.users is required by migration 20261114120000_supabase_auth_user_profiles",
    });
  }, 120_000);
});
