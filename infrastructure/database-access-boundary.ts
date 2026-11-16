/**
 * Database access boundary (Task 14.3).
 *
 * - Application tables are server-only. They are read and written only by
 *   Next.js server code through Prisma (`infrastructure/db.ts`) on the
 *   server-only `DATABASE_URL`. Never query them with a Supabase client
 *   (`from()`, `rpc()`); the browser client is auth-only by design.
 * - Supabase Data API roles (`anon`, `authenticated`) have no privilege on these
 *   tables, and RLS is enabled with no policy (deny by default). See
 *   prisma/migrations/20261114130000_server_only_app_tables_rls/migration.sql.
 * - Prisma connects as the table owner, which bypasses RLS. RLS is therefore
 *   not an authorization layer for the app: per-user authorization is enforced
 *   only by `requireUser()` and the resource predicates of each application
 *   query/command. Keep every new check there, not in RLS policies.
 *
 * A new `public` table must be added here and must enable RLS without granting
 * the Data API roles in its migration; the RLS integration test enforces both.
 */
export const SERVER_ONLY_APP_TABLES = [
  "users",
  "friends",
  "groups",
  "memberships",
  "invites",
  "notification",
  "personal_target",
  "notification_draft",
  "schedule_claim",
  "dispatch",
  "dispatch_recipient",
] as const;

export type ServerOnlyAppTable = (typeof SERVER_ONLY_APP_TABLES)[number];
