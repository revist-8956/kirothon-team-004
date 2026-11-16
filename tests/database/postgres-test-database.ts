import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

import { supabaseDataApiRolesStubSql } from "./supabase-api-roles";
import { SUPABASE_AUTH_SCHEMA_STUB_SQL } from "./supabase-auth-schema";

const DEFAULT_MIGRATION_DIRECTORY = resolve(process.cwd(), "prisma/migrations");
const DATABASE_PREFIX = "kiro_test_";

export interface PostgresTestServer {
  readonly adminUrl: string;
  stop(): Promise<void>;
}

export interface IsolatedPostgresDatabase {
  readonly name: string;
  readonly url: string;
  readonly pool: Pool;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

export interface IsolatedPostgresOptions {
  readonly migrationDirectories?: readonly string[];
  /**
   * Creates the minimal Supabase-owned `auth.users` stand-in before migrations
   * run. Defaults to true; disable it to verify migration behavior without it.
   */
  readonly supabaseAuthSchema?: boolean;
  /**
   * Creates the Supabase Data API roles (`anon`, `authenticated`,
   * `service_role`) with Supabase's default `public` grants before migrations
   * run. Defaults to true.
   */
  readonly supabaseDataApiRoles?: boolean;
}

export interface IsolatedPostgresFixture {
  readonly current: IsolatedPostgresDatabase;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function databaseUrl(adminUrl: string, databaseName: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.delete("schema");
  return url.toString();
}

async function collectSqlFiles(directory: string): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory()
        ? collectSqlFiles(path)
        : entry.isFile() && entry.name.endsWith(".sql")
          ? [path]
          : [];
    }),
  );

  return files.flat().sort((left, right) => left.localeCompare(right));
}

export async function applySqlMigrations(
  database: Pool,
  migrationDirectories: readonly string[] = [DEFAULT_MIGRATION_DIRECTORY],
): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS "_integration_test_migrations" (
      "name" text PRIMARY KEY,
      "applied_at" timestamptz NOT NULL DEFAULT transaction_timestamp()
    )
  `);

  for (const migrationDirectory of migrationDirectories) {
    const absoluteDirectory = resolve(migrationDirectory);
    const files = await collectSqlFiles(absoluteDirectory);

    for (const file of files) {
      const migrationName = `${basename(absoluteDirectory)}/${relative(absoluteDirectory, file)}`;
      const alreadyApplied = await database.query<{ exists: boolean }>(
        `SELECT EXISTS(
          SELECT 1 FROM "_integration_test_migrations" WHERE "name" = $1
        ) AS "exists"`,
        [migrationName],
      );

      if (alreadyApplied.rows[0]?.exists) {
        continue;
      }

      const sql = await readFile(file, "utf8");
      const client = await database.connect();

      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          `INSERT INTO "_integration_test_migrations" ("name") VALUES ($1)`,
          [migrationName],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Failed to apply test migration ${migrationName}`, {
          cause: error,
        });
      } finally {
        client.release();
      }
    }
  }
}

export async function createPostgresTestServer(): Promise<PostgresTestServer> {
  const externalAdminUrl = process.env.TEST_DATABASE_URL;

  if (externalAdminUrl) {
    return {
      adminUrl: externalAdminUrl,
      async stop() {},
    };
  }

  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "postgres:17-alpine",
  )
    .withDatabase("postgres")
    .withUsername("postgres")
    .withPassword("postgres")
    .withEnvironment({ TZ: "UTC" })
    .start();

  return {
    adminUrl: container.getConnectionUri(),
    async stop() {
      await container.stop();
    },
  };
}

export async function createIsolatedPostgresDatabase(
  server: PostgresTestServer,
  options: IsolatedPostgresOptions = {},
): Promise<IsolatedPostgresDatabase> {
  const name = `${DATABASE_PREFIX}${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ connectionString: server.adminUrl, max: 1 });

  try {
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
  } finally {
    await adminPool.end();
  }

  const url = databaseUrl(server.adminUrl, name);
  const pool = new Pool({ connectionString: url, max: 4 });

  try {
    if (options.supabaseAuthSchema ?? true) {
      await pool.query(SUPABASE_AUTH_SCHEMA_STUB_SQL);
    }
    if (options.supabaseDataApiRoles ?? true) {
      const migrationRole = await pool.query<{ role: string }>("SELECT current_user AS role");
      await pool.query(supabaseDataApiRolesStubSql(migrationRole.rows[0]!.role));
    }
    await applySqlMigrations(
      pool,
      options.migrationDirectories ?? [DEFAULT_MIGRATION_DIRECTORY],
    );
  } catch (error) {
    await pool.end();
    await dropDatabase(server.adminUrl, name);
    throw error;
  }

  let disposed = false;

  return {
    name,
    url,
    pool,
    reset() {
      return resetDatabaseData(pool);
    },
    async dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      await pool.end();
      await dropDatabase(server.adminUrl, name);
    },
  };
}

async function resetDatabaseData(pool: Pool): Promise<void> {
  const tables = await pool.query<{ tablename: string }>(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = current_schema()
      AND tablename <> '_integration_test_migrations'
    ORDER BY tablename ASC
  `);

  const tableNames = tables.rows.map(({ tablename }) => quoteIdentifier(tablename));
  const authUsers = await pool.query<{ relation: string | null }>(
    "SELECT to_regclass('auth.users')::text AS relation",
  );
  if (authUsers.rows[0]?.relation) {
    tableNames.push("auth.users");
  }
  if (tableNames.length === 0) {
    return;
  }
  await pool.query(`TRUNCATE TABLE ${tableNames.join(", ")} RESTART IDENTITY CASCADE`);
}

async function dropDatabase(adminUrl: string, name: string): Promise<void> {
  const adminPool = new Pool({ connectionString: adminUrl, max: 1 });

  try {
    await adminPool.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name],
    );
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`);
  } finally {
    await adminPool.end();
  }
}

export function registerIsolatedPostgres(
  options: IsolatedPostgresOptions = {},
): IsolatedPostgresFixture {
  let server: PostgresTestServer | undefined;
  let database: IsolatedPostgresDatabase | undefined;

  beforeAll(async () => {
    server = await createPostgresTestServer();
  }, 120_000);

  beforeEach(async () => {
    if (!server) {
      throw new Error("PostgreSQL test server was not started");
    }
    database = await createIsolatedPostgresDatabase(server, options);
  }, 120_000);

  afterEach(async () => {
    await database?.dispose();
    database = undefined;
  }, 120_000);

  afterAll(async () => {
    await server?.stop();
    server = undefined;
  }, 120_000);

  return {
    get current() {
      if (!database) {
        throw new Error("The isolated PostgreSQL database is only available inside a test");
      }
      return database;
    },
  };
}
