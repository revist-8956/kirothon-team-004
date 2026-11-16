import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { RepositoryUnitOfWork, UserRecord } from "../../application/repositories";

/**
 * Minimal stand-in for the Supabase-owned `auth.users` table.
 *
 * Testcontainers PostgreSQL has no Supabase Auth schema, and application
 * migrations deliberately never create one. The test harness creates this
 * subset of Supabase's real column names before applying migrations so that
 * the `users.id -> auth.users.id` foreign key and the profile trigger run
 * against the same shape they see in Supabase.
 */
export const SUPABASE_AUTH_SCHEMA_STUB_SQL = `
  CREATE SCHEMA IF NOT EXISTS auth;

  CREATE TABLE IF NOT EXISTS auth.users (
    instance_id uuid,
    id uuid NOT NULL PRIMARY KEY,
    aud varchar(255),
    role varchar(255),
    email varchar(255),
    email_confirmed_at timestamptz,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_sso_user boolean NOT NULL DEFAULT false,
    is_anonymous boolean NOT NULL DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS users_email_partial_key
    ON auth.users (email)
    WHERE is_sso_user = false;
`;

type Queryable = Pick<Pool | PoolClient, "query">;

export interface SupabaseAuthUserInput {
  readonly id?: string;
  readonly email: string | null;
  /** Google display name as Supabase stores it in `raw_user_meta_data`. */
  readonly fullName?: string;
  readonly userMetadata?: Record<string, unknown>;
}

/**
 * Inserts a Supabase Auth principal the way Supabase Auth would after a Google
 * sign-in. The migration trigger then creates the application profile.
 */
export async function createSupabaseAuthUser(
  database: Queryable,
  input: SupabaseAuthUserInput,
): Promise<string> {
  const id = input.id ?? randomUUID();
  const userMetadata = input.userMetadata ?? (
    input.fullName === undefined
      ? {}
      : { full_name: input.fullName, name: input.fullName, email: input.email }
  );

  await database.query(
    `INSERT INTO auth.users (
       id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data
     ) VALUES ($1, 'authenticated', 'authenticated', $2, now(), $3::jsonb, $4::jsonb)`,
    [
      id,
      input.email,
      JSON.stringify({ provider: "google", providers: ["google"] }),
      JSON.stringify(userMetadata),
    ],
  );

  return id;
}

/**
 * Creates a Supabase Auth user whose Google name is `nickname` and returns the
 * application profile that the `auth.users` trigger created for it.
 */
export async function createSupabaseProfileUser(
  database: Queryable,
  repositories: RepositoryUnitOfWork,
  input: { readonly email: string; readonly nickname: string },
): Promise<UserRecord> {
  const id = await createSupabaseAuthUser(database, {
    email: input.email,
    fullName: input.nickname,
  });
  const profile = await repositories.transaction((transaction) => transaction.users.findById(id));

  if (!profile) {
    throw new Error("The auth.users trigger did not create an application profile");
  }
  return profile;
}
