-- Task 14.2: Supabase Auth principals become the identity of application profiles.
--
-- Ownership boundary
--   The `auth` schema belongs to Supabase. This migration never creates, alters,
--   or writes to `auth` tables. It only reads `auth.users`, references
--   `auth.users.id` with a foreign key, and attaches an AFTER INSERT trigger;
--   Supabase permits both on `auth.users`.
--   Helper functions live in the non-API schema `app_private` so that they are
--   not exposed through PostgREST RPC.
--
-- Legacy Auth.js data
--   Each existing `public.users` row is mapped to exactly one `auth.users` row by
--   normalized email. The preflight check runs before any write and raises an
--   error that lists unmappable profile IDs, so no profile or domain row is
--   deleted and the migration stops. Mapped profile IDs are rewritten to the
--   Supabase user ID; every domain foreign key declared ON UPDATE CASCADE
--   (friends, groups, memberships, invites, notifications, personal targets,
--   drafts, dispatch recipients) follows automatically; personal draft
--   recipient IDs stored in JSON are rewritten explicitly.
--   Auth.js provider/session tables are dropped only after the mapping is
--   applied. OAuth access, refresh, and ID tokens are never copied anywhere.

-- 1. Preflight: Supabase auth.users exists and every legacy profile maps 1:1.
DO $preflight$
DECLARE
  unmapped_ids text;
  unmapped_count integer;
  ambiguous_ids text;
  ambiguous_count integer;
  conflicting_ids text;
  conflicting_count integer;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'Supabase auth.users is required by migration 20261114120000_supabase_auth_user_profiles'
      USING ERRCODE = 'undefined_table',
            HINT = 'Apply this migration to a Supabase database whose auth schema is managed by Supabase Auth.';
  END IF;

  WITH matches AS (
    SELECT profile.id AS profile_id, count(auth_user.id) AS match_count
    FROM public.users AS profile
    LEFT JOIN auth.users AS auth_user
      ON lower(btrim(auth_user.email)) = profile.email_normalized
    GROUP BY profile.id
  )
  SELECT
    count(*) FILTER (WHERE match_count = 0),
    string_agg(profile_id::text, ', ' ORDER BY profile_id) FILTER (WHERE match_count = 0),
    count(*) FILTER (WHERE match_count > 1),
    string_agg(profile_id::text, ', ' ORDER BY profile_id) FILTER (WHERE match_count > 1)
  INTO unmapped_count, unmapped_ids, ambiguous_count, ambiguous_ids
  FROM matches;

  IF unmapped_count > 0 THEN
    RAISE EXCEPTION 'Legacy profiles without a matching Supabase auth.users email: %', unmapped_count
      USING ERRCODE = 'foreign_key_violation',
            DETAIL = format('Unmapped public.users ids: %s', unmapped_ids),
            HINT = 'Create or link the Supabase Auth user for each listed profile, then re-run the migration. No rows were changed.';
  END IF;

  IF ambiguous_count > 0 THEN
    RAISE EXCEPTION 'Legacy profiles matching more than one Supabase auth.users email: %', ambiguous_count
      USING ERRCODE = 'unique_violation',
            DETAIL = format('Ambiguous public.users ids: %s', ambiguous_ids),
            HINT = 'Resolve duplicate Supabase Auth users for each listed profile, then re-run the migration. No rows were changed.';
  END IF;

  -- A profile may not be renamed onto an ID still held by a different profile.
  SELECT count(*), string_agg(profile.id::text, ', ' ORDER BY profile.id)
  INTO conflicting_count, conflicting_ids
  FROM public.users AS profile
  JOIN auth.users AS auth_user
    ON lower(btrim(auth_user.email)) = profile.email_normalized
  WHERE auth_user.id <> profile.id
    AND EXISTS (SELECT 1 FROM public.users AS other WHERE other.id = auth_user.id);

  IF conflicting_count > 0 THEN
    RAISE EXCEPTION 'Legacy profiles whose Supabase user id is held by another profile: %', conflicting_count
      USING ERRCODE = 'unique_violation',
            DETAIL = format('Conflicting public.users ids: %s', conflicting_ids),
            HINT = 'Resolve the conflicting profile ids manually, then re-run the migration. No rows were changed.';
  END IF;
END
$preflight$;

-- 2. Rewrite each legacy profile ID to its Supabase user ID.
-- 2a. Personal drafts keep recipient IDs in JSON, which FKs cannot cascade.
UPDATE public.notification_draft AS draft
SET target_json = jsonb_set(
  draft.target_json,
  '{recipientIds}',
  (
    SELECT coalesce(
      jsonb_agg(to_jsonb(coalesce(mapping.auth_user_id::text, recipient.value)) ORDER BY recipient.position),
      '[]'::jsonb
    )
    FROM jsonb_array_elements_text(draft.target_json -> 'recipientIds')
      WITH ORDINALITY AS recipient(value, position)
    LEFT JOIN (
      SELECT profile.id AS profile_id, auth_user.id AS auth_user_id
      FROM public.users AS profile
      JOIN auth.users AS auth_user
        ON lower(btrim(auth_user.email)) = profile.email_normalized
    ) AS mapping
      ON mapping.profile_id::text = recipient.value
  )
)
WHERE draft.mode = 'PERSONAL'
  AND jsonb_typeof(draft.target_json -> 'recipientIds') = 'array';

-- 2b. Profile IDs. Every domain FK to users is ON UPDATE CASCADE.
UPDATE public.users AS profile
SET id = auth_user.id
FROM auth.users AS auth_user
WHERE lower(btrim(auth_user.email)) = profile.email_normalized
  AND auth_user.id <> profile.id;

-- 3. Remove Auth.js provider, session, and verification tables. Their OAuth
--    tokens are intentionally discarded rather than copied.
DROP TABLE public.accounts;
DROP TABLE public.sessions;
DROP TABLE public.verification_tokens;

-- 4. The profile ID is now always issued by Supabase Auth.
ALTER TABLE public.users ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.users ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public.users
  DROP COLUMN name,
  DROP COLUMN email_verified,
  DROP COLUMN image;

-- Deleting a Supabase user removes a profile that has no history. Domain
-- history FKs (groups, memberships, notifications, dispatch recipients) remain
-- ON DELETE RESTRICT, so a user with history cannot be silently erased.
ALTER TABLE public.users
  ADD CONSTRAINT users_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users (id)
  ON DELETE CASCADE;

-- 5. Profile creation for Supabase Auth users.
CREATE SCHEMA app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

-- Mirrors JavaScript String.prototype.trim(), used by domain/nickname.ts and
-- domain/email.ts, so database-created profiles follow the application rules.
CREATE FUNCTION app_private.js_trim(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
  SELECT pg_catalog.regexp_replace(
    value,
    '^[\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+$',
    '',
    'g'
  );
$function$;

-- Creates the profile for one Supabase user when it does not exist yet.
--   * email: trimmed provider email; email_normalized: trimmed and lower-cased.
--     Users without an address in the basic service format get no profile.
--   * nickname: trimmed Google `full_name` (falling back to `name`). It is a
--     candidate only: outside 1..20 Unicode code points, nickname_required is
--     set so the user completes profile setup first.
--   * Conflicts on id or normalized email leave the existing profile unchanged
--     and never block Supabase from creating the auth user.
CREATE FUNCTION app_private.create_profile_for_auth_user(
  p_user_id uuid,
  p_email text,
  p_user_metadata jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_email text := app_private.js_trim(coalesce(p_email, ''));
  v_nickname text := coalesce(
    nullif(app_private.js_trim(coalesce(p_user_metadata ->> 'full_name', '')), ''),
    app_private.js_trim(coalesce(p_user_metadata ->> 'name', ''))
  );
BEGIN
  IF v_email !~ '^[^@\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+@[^@.\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+(\.[^@.\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+)+$' THEN
    RETURN;
  END IF;

  INSERT INTO public.users (id, email, email_normalized, nickname, nickname_required)
  VALUES (
    p_user_id,
    v_email,
    pg_catalog.lower(v_email),
    v_nickname,
    NOT (pg_catalog.char_length(v_nickname) BETWEEN 1 AND 20)
  )
  ON CONFLICT DO NOTHING;
END
$function$;

CREATE FUNCTION app_private.handle_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM app_private.create_profile_for_auth_user(NEW.id, NEW.email, NEW.raw_user_meta_data);
  RETURN NEW;
END
$function$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;

CREATE TRIGGER on_auth_user_created_create_app_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION app_private.handle_auth_user_created();

-- 6. Supabase users that existed before this migration but had no profile.
SELECT app_private.create_profile_for_auth_user(auth_user.id, auth_user.email, auth_user.raw_user_meta_data)
FROM auth.users AS auth_user
WHERE NOT EXISTS (SELECT 1 FROM public.users AS profile WHERE profile.id = auth_user.id)
ORDER BY auth_user.created_at, auth_user.id;
