-- Task 2.2: notification schedules, dispatch snapshots, and responses.
-- This migration intentionally follows the Task 2.1 users/groups migration.

CREATE TYPE "DeliveryMode" AS ENUM ('PERSONAL', 'GROUP');
CREATE TYPE "ScheduleKind" AS ENUM ('ONE_TIME', 'RECURRING');
CREATE TYPE "Recurrence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "NotificationState" AS ENUM ('ACTIVE', 'STOPPED');
CREATE TYPE "ClaimState" AS ENUM ('SENT', 'SKIPPED');
CREATE TYPE "SkipReason" AS ENUM ('SENDER_NOT_MEMBER', 'NO_RECIPIENTS');

CREATE TABLE "notification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sender_id" UUID NOT NULL,
    "sentence" TEXT NOT NULL,
    "mode" "DeliveryMode" NOT NULL,
    "group_id" UUID,
    "schedule_kind" "ScheduleKind" NOT NULL,
    "one_time_at" TIMESTAMPTZ(6),
    "recurrence" "Recurrence",
    "start_date" DATE,
    "weekday" INTEGER,
    "day_of_month" INTEGER,
    "local_time" TIME(0),
    "skip_weekend" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
    "state" "NotificationState" NOT NULL DEFAULT 'ACTIVE',
    "stopped_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_sentence_not_blank_check"
      CHECK ("sentence" ~ '[^[:space:]]'),
    CONSTRAINT "notification_target_xor_check"
      CHECK (
        ("mode" = 'PERSONAL' AND "group_id" IS NULL)
        OR ("mode" = 'GROUP' AND "group_id" IS NOT NULL)
      ),
    CONSTRAINT "notification_schedule_fields_check"
      CHECK (
        (
          "schedule_kind" = 'ONE_TIME'
          AND "one_time_at" IS NOT NULL
          AND "recurrence" IS NULL
          AND "start_date" IS NULL
          AND "weekday" IS NULL
          AND "day_of_month" IS NULL
          AND "local_time" IS NULL
        )
        OR
        (
          "schedule_kind" = 'RECURRING'
          AND "one_time_at" IS NULL
          AND "recurrence" IS NOT NULL
          AND "start_date" IS NOT NULL
          AND "local_time" IS NOT NULL
          AND (
            ("recurrence" = 'DAILY' AND "weekday" IS NULL AND "day_of_month" IS NULL)
            OR ("recurrence" = 'WEEKLY' AND "weekday" BETWEEN 1 AND 7 AND "day_of_month" IS NULL)
            OR ("recurrence" = 'MONTHLY' AND "weekday" IS NULL AND "day_of_month" BETWEEN 1 AND 31)
          )
        )
      ),
    CONSTRAINT "notification_timezone_check"
      CHECK ("timezone" = 'Asia/Seoul')
);

CREATE TABLE "personal_target" (
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_target_pkey" PRIMARY KEY ("notification_id", "user_id")
);

CREATE TABLE "notification_draft" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "sentence" TEXT NOT NULL,
    "mode" "DeliveryMode" NOT NULL,
    "target_json" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_draft_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_draft_sentence_not_blank_check"
      CHECK ("sentence" ~ '[^[:space:]]')
);

CREATE TABLE "schedule_claim" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID NOT NULL,
    "effective_date" DATE NOT NULL,
    "source_dates" DATE[] NOT NULL,
    "state" "ClaimState" NOT NULL,
    "skip_reason" "SkipReason",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_claim_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "schedule_claim_outcome_check"
      CHECK (
        ("state" = 'SENT' AND "skip_reason" IS NULL)
        OR ("state" = 'SKIPPED' AND "skip_reason" IS NOT NULL)
      )
);

CREATE TABLE "dispatch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "effective_date" DATE NOT NULL,
    "sent_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dispatch_sequence_positive_check" CHECK ("sequence" > 0)
);

CREATE TABLE "dispatch_recipient" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dispatch_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "recipient_nickname_snapshot" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_recipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "schedule_claim_notification_effective_key"
  ON "schedule_claim"("notification_id", "effective_date");
CREATE UNIQUE INDEX "dispatch_claim_key" ON "dispatch"("claim_id");
CREATE UNIQUE INDEX "dispatch_notification_effective_key"
  ON "dispatch"("notification_id", "effective_date");
CREATE UNIQUE INDEX "dispatch_notification_sequence_key"
  ON "dispatch"("notification_id", "sequence");
CREATE UNIQUE INDEX "dispatch_recipient_dispatch_recipient_key"
  ON "dispatch_recipient"("dispatch_id", "recipient_id");

CREATE INDEX "notification_due_one_time_idx"
  ON "notification"("state", "schedule_kind", "one_time_at");
CREATE INDEX "notification_due_recurring_idx"
  ON "notification"("state", "recurrence", "start_date");
CREATE INDEX "notification_sender_created_idx"
  ON "notification"("sender_id", "created_at" DESC);
CREATE INDEX "notification_group_idx" ON "notification"("group_id");
CREATE INDEX "personal_target_user_idx" ON "personal_target"("user_id");
CREATE INDEX "notification_draft_owner_expiry_idx"
  ON "notification_draft"("owner_id", "expires_at");
CREATE INDEX "notification_draft_expiry_idx" ON "notification_draft"("expires_at");
CREATE INDEX "schedule_claim_state_effective_idx"
  ON "schedule_claim"("state", "effective_date");
CREATE INDEX "dispatch_notification_sent_idx"
  ON "dispatch"("notification_id", "sent_at" DESC);
CREATE INDEX "dispatch_recipient_inbox_idx"
  ON "dispatch_recipient"("recipient_id", "dispatch_id");
CREATE INDEX "dispatch_recipient_confirmation_idx"
  ON "dispatch_recipient"("dispatch_id", "confirmed_at");

ALTER TABLE "notification"
  ADD CONSTRAINT "notification_sender_id_fkey"
  FOREIGN KEY ("sender_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification"
  ADD CONSTRAINT "notification_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "groups"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "personal_target"
  ADD CONSTRAINT "personal_target_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "notification"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "personal_target"
  ADD CONSTRAINT "personal_target_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_draft"
  ADD CONSTRAINT "notification_draft_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_claim"
  ADD CONSTRAINT "schedule_claim_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "notification"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dispatch"
  ADD CONSTRAINT "dispatch_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "notification"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dispatch"
  ADD CONSTRAINT "dispatch_claim_id_fkey"
  FOREIGN KEY ("claim_id") REFERENCES "schedule_claim"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispatch_recipient"
  ADD CONSTRAINT "dispatch_recipient_dispatch_id_fkey"
  FOREIGN KEY ("dispatch_id") REFERENCES "dispatch"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dispatch_recipient"
  ADD CONSTRAINT "dispatch_recipient_recipient_id_fkey"
  FOREIGN KEY ("recipient_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
