import type { Pool, PoolClient } from "pg";

type Queryable = Pick<Pool | PoolClient, "query">;

/** Roles PostgREST (Supabase Data API) switches into for browser requests. */
export const SUPABASE_DATA_API_ROLES = ["anon", "authenticated"] as const;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * Minimal stand-in for the Supabase Data API roles and their default grants.
 *
 * Testcontainers PostgreSQL has no `anon`, `authenticated` or `service_role`.
 * Roles are cluster-wide, so they are created idempotently (concurrent test
 * files may race on the same server). Like Supabase, `public` usage is granted
 * to them and every table, sequence and function that `migrationRole` creates
 * in `public` is granted to them by default. Application migrations must remove
 * that exposure themselves; this stub reproduces the starting point they face.
 *
 * Must run as a superuser in the target database before migrations.
 */
export function supabaseDataApiRolesStubSql(migrationRole: string): string {
  const owner = quoteIdentifier(migrationRole);
  return `
    DO $roles$
    BEGIN
      BEGIN
        CREATE ROLE anon NOLOGIN NOINHERIT;
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END;
      BEGIN
        CREATE ROLE authenticated NOLOGIN NOINHERIT;
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END;
      BEGIN
        CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END;
    END
    $roles$;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public
      GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public
      GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public
      GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  `;
}

export type SupabaseDataApiRole = (typeof SUPABASE_DATA_API_ROLES)[number];

/**
 * Runs `work` the way PostgREST runs a Data API request: inside a transaction,
 * as the given API role, with the request JWT claims set. The transaction is
 * always rolled back so attempted writes never persist.
 *
 * `client` must be connected as a role that may `SET ROLE` to the API role
 * (the superuser test connection, like PostgREST's `authenticator`).
 */
export async function asSupabaseDataApiRole<T>(
  client: PoolClient,
  role: SupabaseDataApiRole,
  userId: string | null,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(role)}`);
    const claims = userId === null ? { role } : { role, sub: userId };
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(claims),
    ]);
    return await work(client);
  } finally {
    await client.query("ROLLBACK");
  }
}

/** Grants a non-superuser migration role what Supabase grants `postgres`. */
export async function grantSupabaseMigrationRolePrivileges(
  database: Queryable,
  databaseName: string,
  migrationRole: string,
): Promise<void> {
  const owner = quoteIdentifier(migrationRole);
  await database.query(`
    GRANT CREATE ON DATABASE ${quoteIdentifier(databaseName)} TO ${owner};
    GRANT ALL ON SCHEMA public TO ${owner};
    GRANT USAGE ON SCHEMA auth TO ${owner};
    GRANT SELECT, REFERENCES, TRIGGER ON auth.users TO ${owner};
  `);
}
