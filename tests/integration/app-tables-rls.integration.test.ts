import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getGroupDetail, getGroups } from "@/application/group-queries";
import { SERVER_ONLY_APP_TABLES } from "@/infrastructure/database-access-boundary";
import { PrismaRepositoryUnitOfWork } from "@/infrastructure/prisma-repositories";
import {
  applySqlMigrations,
  createIsolatedPostgresDatabase,
  createPostgresTestServer,
  type PostgresTestServer,
} from "../database/postgres-test-database";
import {
  asSupabaseDataApiRole,
  grantSupabaseMigrationRolePrivileges,
  SUPABASE_DATA_API_ROLES,
  supabaseDataApiRolesStubSql,
  type SupabaseDataApiRole,
} from "../database/supabase-api-roles";
import {
  createSupabaseAuthUser,
  createSupabaseProfileUser,
  SUPABASE_AUTH_SCHEMA_STUB_SQL,
} from "../database/supabase-auth-schema";

const MIGRATIONS = resolve(process.cwd(), "prisma/migrations");
const RLS_MIGRATION = resolve(MIGRATIONS, "20261114130000_server_only_app_tables_rls");
const MIGRATIONS_BEFORE_RLS = [
  resolve(MIGRATIONS, "20261114081236_auth_users_friends_groups_invites"),
  resolve(MIGRATIONS, "20261114081245_notification_delivery_schema"),
  resolve(MIGRATIONS, "20261114120000_supabase_auth_user_profiles"),
];
/** Test-harness bookkeeping, not part of the application schema. */
const HARNESS_TABLE = "_integration_test_migrations";
const PRISMA_HISTORY_TABLE = "_prisma_migrations";
const TABLE_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
const PERMISSION_DENIED = "42501";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function urlFor(adminUrl: string, database: string, credentials?: { user: string; password: string }) {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  if (credentials) {
    url.username = credentials.user;
    url.password = credentials.password;
  }
  return url.toString();
}

type Attempt = { readonly code: string } | { readonly rowCount: number; readonly rows: unknown[] };

/** Runs one statement the way a PostgREST request would, and reports the outcome. */
async function attempt(
  client: PoolClient,
  role: SupabaseDataApiRole,
  userId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<Attempt> {
  return asSupabaseDataApiRole(client, role, userId, async (api) => {
    try {
      const result = await api.query(sql, params);
      return { rowCount: result.rowCount ?? 0, rows: result.rows };
    } catch (error) {
      return { code: (error as { code?: string }).code ?? "unknown" };
    }
  });
}

/**
 * A Supabase-shaped database: a non-superuser migration/runtime role without
 * BYPASSRLS owns the application tables (Supabase `postgres`), Supabase's default
 * Data API grants apply to what it creates, and Prisma Migrate's history table
 * exists before the first migration, as it does under `prisma migrate deploy`.
 */
interface SupabaseShapedDatabase {
  readonly name: string;
  readonly ownerRole: string;
  readonly ownerUrl: string;
  /** Superuser connection: seeds `auth.users` and plays PostgREST's `authenticator`. */
  readonly admin: Pool;
  readonly owner: Pool;
  dispose(): Promise<void>;
}

async function createSupabaseShapedDatabase(server: PostgresTestServer): Promise<SupabaseShapedDatabase> {
  const suffix = randomUUID().replaceAll("-", "");
  const name = `kiro_test_rls_${suffix}`;
  const ownerRole = `kiro_runtime_${suffix}`;
  const password = randomUUID();
  const serverPool = new Pool({ connectionString: server.adminUrl, max: 1 });
  await serverPool.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
  await serverPool.query(
    `CREATE ROLE ${quoteIdentifier(ownerRole)} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${password}'`,
  );
  const admin = new Pool({ connectionString: urlFor(server.adminUrl, name), max: 2 });
  const ownerUrl = urlFor(server.adminUrl, name, { user: ownerRole, password });
  const owner = new Pool({ connectionString: ownerUrl, max: 2 });
  const dispose = async () => {
    await Promise.allSettled([admin.end(), owner.end()]);
    await serverPool.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [name],
    );
    await serverPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`);
    await serverPool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(ownerRole)}`);
    await serverPool.end();
  };
  try {
    await admin.query(SUPABASE_AUTH_SCHEMA_STUB_SQL);
    await admin.query(supabaseDataApiRolesStubSql(ownerRole));
    await grantSupabaseMigrationRolePrivileges(admin, name, ownerRole);
    await owner.query(`CREATE TABLE public.${PRISMA_HISTORY_TABLE} (id varchar(36) PRIMARY KEY)`);
    await applySqlMigrations(owner, [...MIGRATIONS_BEFORE_RLS, RLS_MIGRATION]);
  } catch (error) {
    await dispose();
    throw error;
  }
  return { name, ownerRole, ownerUrl, admin, owner, dispose };
}

let server: PostgresTestServer;
let database: SupabaseShapedDatabase;
let client: PoolClient;

beforeAll(async () => {
  server = await createPostgresTestServer();
  database = await createSupabaseShapedDatabase(server);
  client = await database.admin.connect();
}, 120_000);

afterAll(async () => {
  client?.release();
  await database?.dispose();
  await server?.stop();
}, 120_000);

describe("server-only application tables (Task 14.3)", () => {
  it("removes the Data API access that Supabase grants on new public tables", async () => {
    const control = await createIsolatedPostgresDatabase(server, {
      migrationDirectories: MIGRATIONS_BEFORE_RLS,
    });
    const controlClient = await control.pool.connect();
    try {
      const userId = await createSupabaseAuthUser(controlClient, {
        email: `${randomUUID()}@example.test`,
        fullName: "노출확인",
      });
      const before = await attempt(controlClient, "anon", null, "SELECT id FROM public.users");
      expect(before).toEqual({ rowCount: 1, rows: [{ id: userId }] });

      await applySqlMigrations(control.pool, [RLS_MIGRATION]);

      for (const role of SUPABASE_DATA_API_ROLES) {
        expect(await attempt(controlClient, role, userId, "SELECT id FROM public.users")).toEqual({
          code: PERMISSION_DENIED,
        });
      }
    } finally {
      controlClient.release();
      await control.dispose();
    }
  }, 120_000);

  it("enables deny-by-default RLS on every public table without FORCE or policies", async () => {
    const tables = await database.admin.query<{ table: string; rls: boolean; forced: boolean; owner: string }>(
      `SELECT c.relname AS "table", c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> $1
       ORDER BY c.relname COLLATE "C"`,
      [HARNESS_TABLE],
    );
    expect(tables.rows.map((row) => row.table)).toEqual(
      [...SERVER_ONLY_APP_TABLES, PRISMA_HISTORY_TABLE].sort(),
    );
    for (const row of tables.rows) {
      expect(row, row.table).toMatchObject({ rls: true, forced: false, owner: database.ownerRole });
    }
    const policies = await database.admin.query("SELECT policyname FROM pg_policies WHERE schemaname = 'public'");
    expect(policies.rows).toEqual([]);
  });

  it("gives the Data API roles no privilege on app tables, future public objects or app_private", async () => {
    const tables = [...SERVER_ONLY_APP_TABLES, PRISMA_HISTORY_TABLE];
    for (const role of SUPABASE_DATA_API_ROLES) {
      for (const table of tables) {
        const granted = await database.admin.query<{ granted: boolean }>(
          "SELECT has_table_privilege($1, $2, $3) AS granted",
          [role, `public.${table}`, TABLE_PRIVILEGES.join(", ")],
        );
        expect(granted.rows[0]?.granted, `${role} on ${table}`).toBe(false);
      }
      const schema = await database.admin.query<{ usage: boolean }>(
        "SELECT has_schema_privilege($1, 'app_private', 'USAGE') AS usage",
        [role],
      );
      expect(schema.rows[0]?.usage).toBe(false);
      const functions = await database.admin.query<{ name: string; execute: boolean }>(
        `SELECT p.proname AS name, has_function_privilege($1, p.oid, 'EXECUTE') AS execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'app_private'`,
        [role],
      );
      expect(functions.rows.length).toBeGreaterThan(0);
      expect(functions.rows.filter((row) => row.execute)).toEqual([]);
    }

    // A table a later migration creates is not exposed by Supabase's default grants.
    const ownerClient = await database.owner.connect();
    try {
      await ownerClient.query("BEGIN");
      await ownerClient.query("CREATE TABLE public.kiro_future_table (id uuid PRIMARY KEY)");
      const future = await ownerClient.query<{ role: string; granted: boolean }>(
        `SELECT role, has_table_privilege(role, 'public.kiro_future_table', $1) AS granted
         FROM unnest($2::text[]) AS role`,
        [TABLE_PRIVILEGES.join(", "), [...SUPABASE_DATA_API_ROLES]],
      );
      expect(future.rows.filter((row) => row.granted)).toEqual([]);
    } finally {
      await ownerClient.query("ROLLBACK");
      ownerClient.release();
    }
  });

  it("denies Data API reads and writes of user data to anon and to the signed-in user", async () => {
    const userId = await createSupabaseAuthUser(database.admin, {
      email: `${randomUUID()}@example.test`,
      fullName: "본인",
    });
    const statements: Array<[string, unknown[]]> = [
      ...SERVER_ONLY_APP_TABLES.map((table): [string, unknown[]] => [`SELECT * FROM public.${table}`, []]),
      ["UPDATE public.users SET nickname = 'changed' WHERE id = $1", [userId]],
      ["DELETE FROM public.users WHERE id = $1", [userId]],
      ["INSERT INTO public.friends (owner_id, friend_id) VALUES ($1, $1)", [userId]],
      ["INSERT INTO public.groups (name, created_by_id) VALUES ('g', $1)", [userId]],
      ["SELECT app_private.create_profile_for_auth_user($1, 'x@example.test', '{}'::jsonb)", [userId]],
    ];
    for (const role of SUPABASE_DATA_API_ROLES) {
      for (const [sql, params] of statements) {
        expect(await attempt(client, role, userId, sql, params), `${role}: ${sql}`).toEqual({
          code: PERMISSION_DENIED,
        });
      }
    }
    const profile = await database.admin.query("SELECT nickname FROM public.users WHERE id = $1", [userId]);
    expect(profile.rows).toEqual([{ nickname: "본인" }]);
  });

  it("keeps rows hidden by RLS even if a Data API grant is re-added by mistake", async () => {
    const userId = await createSupabaseAuthUser(database.admin, {
      email: `${randomUUID()}@example.test`,
      fullName: "실수권한",
    });
    await client.query("BEGIN");
    try {
      await client.query("GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated");
      await client.query("SET LOCAL ROLE authenticated");
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ role: "authenticated", sub: userId }),
      ]);
      const read = await client.query("SELECT id FROM public.users WHERE id = $1", [userId]);
      expect(read.rowCount).toBe(0);
      const update = await client.query("UPDATE public.users SET nickname = 'x' WHERE id = $1", [userId]);
      expect(update.rowCount).toBe(0);
      const remove = await client.query("DELETE FROM public.users WHERE id = $1", [userId]);
      expect(remove.rowCount).toBe(0);
      await expect(
        client.query(
          "INSERT INTO public.users (id, email, email_normalized, nickname) VALUES ($1, 'a@b.test', 'a@b.test', 'x')",
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: PERMISSION_DENIED });
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("lets the server-only Prisma runtime role bypass RLS as table owner with server predicates intact", async () => {
    const role = await database.admin.query<{ super: boolean; bypass: boolean }>(
      "SELECT rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname = $1",
      [database.ownerRole],
    );
    // RLS is bypassed through table ownership alone, as with Supabase `postgres`.
    expect(role.rows[0]).toEqual({ super: false, bypass: false });

    const prisma = new PrismaClient({ datasources: { db: { url: database.ownerUrl } } });
    try {
      const repositories = new PrismaRepositoryUnitOfWork(prisma);
      const member = await createSupabaseProfileUser(database.admin, repositories, {
        email: `${randomUUID()}@example.test`,
        nickname: "구성원",
      });
      const outsider = await createSupabaseProfileUser(database.admin, repositories, {
        email: `${randomUUID()}@example.test`,
        nickname: "외부인",
      });
      const group = await repositories.transaction(async (transaction) => {
        const created = await transaction.groups.create({ name: "운영팀", createdById: member.id });
        await transaction.memberships.create({ groupId: created.id, userId: member.id });
        await transaction.friends.create(member.id, outsider.id);
        await transaction.drafts.create({
          ownerId: member.id,
          sentence: "확인해 주세요",
          mode: "PERSONAL",
          targetJson: { recipientIds: [outsider.id] },
          expiresAt: new Date(Date.now() + 60_000),
        });
        return created;
      });

      expect((await getGroups(member.id, repositories)).map((item) => item.id)).toEqual([group.id]);
      expect(await getGroupDetail(group.id, member.id, repositories)).toMatchObject({ id: group.id });
      // Authorization comes from the server predicate, not from RLS.
      expect(await getGroupDetail(group.id, outsider.id, repositories)).toBeNull();
      expect(await getGroups(outsider.id, repositories)).toEqual([]);
      expect(
        await repositories.transaction((transaction) => transaction.friends.listFriendIds(member.id)),
      ).toEqual([outsider.id]);

      // The same rows stay invisible to the Data API roles.
      expect(await attempt(client, "authenticated", member.id, "SELECT id FROM public.groups")).toEqual({
        code: PERMISSION_DENIED,
      });
    } finally {
      await prisma.$disconnect();
    }
  }, 120_000);
});
