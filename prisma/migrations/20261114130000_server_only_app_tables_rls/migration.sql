-- Task 14.3: Application tables are reachable only through server-side Prisma.
--
-- Access model
--   * Supabase exposes the `public` schema through the Data API (PostgREST),
--     which runs every browser request as `anon` or `authenticated`. Supabase
--     also grants those roles ALL on new `public` tables by default.
--   * This application never reads or writes domain data through the Data API.
--     The browser Supabase client is auth-only (infrastructure/supabase/
--     browser-client.ts). All domain access goes through Next.js server code and
--     Prisma on the server-only `DATABASE_URL`.
--   * Two independent layers deny the Data API roles:
--       1. Least privilege: every table privilege of `anon` and `authenticated`
--          is revoked, also for objects this role creates later in `public`.
--       2. Deny-by-default RLS: RLS is enabled and no policy is created, so even
--          if a grant is re-added by mistake, those roles see and change no row.
--   * Prisma connects as the role that owns these tables (Supabase `postgres`,
--     the same role that runs this migration). A table owner bypasses RLS unless
--     FORCE ROW LEVEL SECURITY is set, which this migration deliberately does
--     not do. Existing server behavior is therefore unchanged.
--
-- Authorization responsibility
--   RLS here is a perimeter for the Data API only. It holds no per-user rule and
--   is NOT the IDOR defense. Per-user authorization is enforced only by
--   `requireUser()` (application/authentication.ts) and the resource predicates
--   of each application query/command (sender, recipient, current membership,
--   draft owner). Do not move those checks into RLS policies, and do not add
--   Data API policies or grants for these tables; add server code instead.
--
-- New tables
--   A migration that adds a `public` table must enable RLS on it in the same
--   migration and must not grant it to `anon` or `authenticated`.
--   tests/integration/app-tables-rls.integration.test.ts fails otherwise.

-- 1. Preflight: the Supabase Data API roles exist (Supabase always creates them).
DO $preflight$
DECLARE
  missing_roles text;
BEGIN
  SELECT string_agg(required.role_name, ', ' ORDER BY required.role_name)
  INTO missing_roles
  FROM (VALUES ('anon'), ('authenticated')) AS required(role_name)
  WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = required.role_name);

  IF missing_roles IS NOT NULL THEN
    RAISE EXCEPTION 'Supabase Data API roles are required by migration 20261114130000_server_only_app_tables_rls: %', missing_roles
      USING ERRCODE = 'undefined_object',
            HINT = 'Apply this migration to a Supabase database. No rows or privileges were changed.';
  END IF;
END
$preflight$;

-- 2. Deny-by-default RLS. No policy is created on purpose.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_target ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_recipient ENABLE ROW LEVEL SECURITY;

-- 3. Least privilege for the Data API roles.
REVOKE ALL ON TABLE
  public.users,
  public.friends,
  public.groups,
  public.memberships,
  public.invites,
  public.notification,
  public.personal_target,
  public.notification_draft,
  public.schedule_claim,
  public.dispatch,
  public.dispatch_recipient
FROM anon, authenticated;

-- Prisma Migrate's history table also lives in `public` when Prisma applies
-- migrations. It is absent when SQL is applied by other tooling.
DO $prisma_history$
BEGIN
  IF pg_catalog.to_regclass('public._prisma_migrations') IS NOT NULL THEN
    ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public._prisma_migrations FROM anon, authenticated;
  END IF;
END
$prisma_history$;

-- Objects created later in `public` by this (migration/runtime) role are not
-- granted to the Data API roles automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- The profile trigger helpers stay unreachable from the Data API (RPC).
REVOKE ALL ON SCHEMA app_private FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM anon, authenticated;
