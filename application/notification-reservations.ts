import { DateTime } from "luxon";
import { z } from "zod";

import { ApplicationError } from "./action-result";
import {
  GROUP_ACCESS_ERROR_MESSAGE,
  NON_FRIEND_RECIPIENT_ERROR_MESSAGE,
} from "./notification-drafts";
import type {
  CreateNotificationInput,
  NotificationDraftRecord,
  NotificationRecord,
  RepositoryTransaction,
  RepositoryUnitOfWork,
} from "./repositories";
import { SCHEDULE_TIMEZONE, getNextDispatchPreview, type ScheduleSpec } from "../domain/schedule";

const DRAFT_UNAVAILABLE_MESSAGE = "알림 작성 정보를 찾을 수 없어요. 알림을 다시 작성해 주세요.";
const DRAFT_EXPIRED_MESSAGE = "작성한 지 30분이 지났어요. 알림을 다시 작성해 주세요.";
const DRAFT_CONSUMED_MESSAGE = "이미 예약한 알림이에요.";
const PAST_ONE_TIME_MESSAGE = "과거 시각에는 예약할 수 없어요.";
const PAST_START_DATE_MESSAGE = "반복 시작일은 오늘 이후로 선택해 주세요.";
const INVALID_SCHEDULE_MESSAGE = "발송 일정을 확인해 주세요.";

export type ScheduleFieldName = "oneTimeDate" | "startDate" | "localTime" | "weekday" | "dayOfMonth";

const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const localTimePattern = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/u;

const oneTimeScheduleSchema = z
  .object({
    kind: z.literal("ONE_TIME"),
    at: z.iso.datetime({ offset: true, error: "발송 일시를 선택해 주세요." }),
  })
  .strict();

const recurringScheduleSchema = z
  .object({
    kind: z.literal("RECURRING"),
    recurrence: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
    startDate: z.string().regex(datePattern, "날짜를 선택해 주세요."),
    localTime: z.string().regex(localTimePattern, "발송 시각을 선택해 주세요."),
    weekday: z.number().int().min(1).max(7).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    skipWeekend: z.boolean(),
    timezone: z.literal(SCHEDULE_TIMEZONE).default(SCHEDULE_TIMEZONE),
  })
  .strict()
  .superRefine((schedule, context) => {
    // Mirrors notification_schedule_fields_check: only the field of the chosen recurrence is set.
    if (schedule.recurrence === "WEEKLY" && schedule.weekday === undefined) {
      context.addIssue({ code: "custom", path: ["weekday"], message: "요일을 선택해 주세요." });
    }
    if (schedule.recurrence !== "WEEKLY" && schedule.weekday !== undefined) {
      context.addIssue({ code: "custom", path: ["weekday"], message: INVALID_SCHEDULE_MESSAGE });
    }
    if (schedule.recurrence === "MONTHLY" && schedule.dayOfMonth === undefined) {
      context.addIssue({
        code: "custom",
        path: ["dayOfMonth"],
        message: "매월 날짜는 1일부터 31일 사이여야 해요.",
      });
    }
    if (schedule.recurrence !== "MONTHLY" && schedule.dayOfMonth !== undefined) {
      context.addIssue({ code: "custom", path: ["dayOfMonth"], message: INVALID_SCHEDULE_MESSAGE });
    }
  });

const scheduleNotificationSchema = z
  .object({
    draftId: z.uuid({ error: DRAFT_UNAVAILABLE_MESSAGE }),
    schedule: z.discriminatedUnion("kind", [oneTimeScheduleSchema, recurringScheduleSchema]),
  })
  .strict();

const personalDraftTargetSchema = z.object({ recipientIds: z.array(z.uuid()).min(1) }).strict();
const groupDraftTargetSchema = z.object({ groupId: z.uuid() }).strict();

export type ScheduleNotificationInput = z.input<typeof scheduleNotificationSchema>;

export interface ScheduledNotification {
  readonly notificationId: string;
  readonly mode: "PERSONAL" | "GROUP";
}

/**
 * Turns a compose draft and a KST schedule into one notification (Task 7.7).
 *
 * In one transaction it consumes the draft (owner, unexpired, not yet used),
 * re-checks the friend or current-membership permission, and creates the
 * notification with its fixed personal targets. Any failure rolls back the
 * draft consumption too, so the user can fix the schedule and retry. A
 * concurrent duplicate submission waits on the draft row and then fails with
 * CONFLICT, so one draft never creates two notifications.
 */
export async function scheduleNotification(
  repositories: RepositoryUnitOfWork,
  actorUserId: string,
  input: unknown,
): Promise<ScheduledNotification> {
  const parsed = scheduleNotificationSchema.safeParse(input);
  if (!parsed.success) {
    throw scheduleValidationError(parsed.error);
  }
  const { draftId } = parsed.data;
  const schedule = parsed.data.schedule as ScheduleSpec;

  return repositories.transaction(async (transaction) => {
    const now = await transaction.now();
    assertSchedulable(schedule, now);

    const draft = await consumeDraft(transaction, draftId, actorUserId, now);
    const notificationInput = {
      senderId: actorUserId,
      sentence: draft.sentence,
      ...toNotificationScheduleFields(schedule),
    };

    if (draft.mode === "PERSONAL") {
      const target = personalDraftTargetSchema.safeParse(draft.targetJson);
      if (!target.success) {
        throw new ApplicationError("VALIDATION_ERROR", { message: DRAFT_UNAVAILABLE_MESSAGE });
      }
      const recipientIds = [...new Set(target.data.recipientIds)];
      const friendIds = new Set(await transaction.friends.listFriendIds(actorUserId));
      if (recipientIds.some((recipientId) => !friendIds.has(recipientId))) {
        throw new ApplicationError("FORBIDDEN", { message: NON_FRIEND_RECIPIENT_ERROR_MESSAGE });
      }
      const notification = await transaction.notifications.create({
        ...notificationInput,
        mode: "PERSONAL",
        groupId: null,
      });
      await transaction.notifications.createPersonalTargets(notification.id, recipientIds);
      return { notificationId: notification.id, mode: "PERSONAL" };
    }

    const target = groupDraftTargetSchema.safeParse(draft.targetJson);
    if (!target.success) {
      throw new ApplicationError("VALIDATION_ERROR", { message: DRAFT_UNAVAILABLE_MESSAGE });
    }
    await transaction.lockGroup(target.data.groupId);
    const membership = await transaction.memberships.findCurrent(target.data.groupId, actorUserId);
    if (!membership) {
      throw new ApplicationError("FORBIDDEN", { message: GROUP_ACCESS_ERROR_MESSAGE });
    }
    const notification = await transaction.notifications.create({
      ...notificationInput,
      mode: "GROUP",
      groupId: target.data.groupId,
    });
    return { notificationId: notification.id, mode: "GROUP" };
  });
}

/**
 * Database columns for a schedule. `@db.Date` and `@db.Time` values are
 * carried as UTC-midnight and 1970-01-01 UTC instants; they hold the KST
 * calendar date and wall-clock time, not a converted instant.
 */
export function toNotificationScheduleFields(
  schedule: ScheduleSpec,
): Pick<
  CreateNotificationInput,
  | "scheduleKind"
  | "oneTimeAt"
  | "recurrence"
  | "startDate"
  | "weekday"
  | "dayOfMonth"
  | "localTime"
  | "skipWeekend"
  | "timezone"
> {
  if (schedule.kind === "ONE_TIME") {
    return {
      scheduleKind: "ONE_TIME",
      oneTimeAt: new Date(schedule.at),
      recurrence: null,
      startDate: null,
      weekday: null,
      dayOfMonth: null,
      localTime: null,
      skipWeekend: false,
      timezone: SCHEDULE_TIMEZONE,
    };
  }
  const [hour, minute, second = "00"] = schedule.localTime.split(":");
  return {
    scheduleKind: "RECURRING",
    oneTimeAt: null,
    recurrence: schedule.recurrence,
    startDate: new Date(`${schedule.startDate}T00:00:00.000Z`),
    weekday: schedule.recurrence === "WEEKLY" ? (schedule.weekday ?? null) : null,
    dayOfMonth: schedule.recurrence === "MONTHLY" ? (schedule.dayOfMonth ?? null) : null,
    localTime: new Date(`1970-01-01T${hour}:${minute}:${second}.000Z`),
    skipWeekend: schedule.skipWeekend,
    timezone: SCHEDULE_TIMEZONE,
  };
}

/** Rebuilds the schedule of a stored notification; the inverse of `toNotificationScheduleFields`. */
export function toScheduleSpec(
  notification: Pick<
    NotificationRecord,
    "scheduleKind" | "oneTimeAt" | "recurrence" | "startDate" | "weekday" | "dayOfMonth" | "localTime" | "skipWeekend"
  >,
): ScheduleSpec {
  if (notification.scheduleKind === "ONE_TIME") {
    if (!notification.oneTimeAt) {
      throw new RangeError("A one-time notification has no oneTimeAt.");
    }
    return { kind: "ONE_TIME", at: notification.oneTimeAt.toISOString() };
  }
  if (!notification.recurrence || !notification.startDate || !notification.localTime) {
    throw new RangeError("A recurring notification is missing its schedule fields.");
  }
  return {
    kind: "RECURRING",
    recurrence: notification.recurrence,
    startDate: notification.startDate.toISOString().slice(0, 10),
    localTime: notification.localTime.toISOString().slice(11, 19),
    ...(notification.weekday !== null
      ? { weekday: notification.weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7 }
      : {}),
    ...(notification.dayOfMonth !== null ? { dayOfMonth: notification.dayOfMonth } : {}),
    skipWeekend: notification.skipWeekend,
    timezone: SCHEDULE_TIMEZONE,
  };
}

function assertSchedulable(schedule: ScheduleSpec, now: Date): void {
  if (schedule.kind === "ONE_TIME") {
    if (new Date(schedule.at).getTime() <= now.getTime()) {
      throw fieldError("oneTimeDate", PAST_ONE_TIME_MESSAGE);
    }
    return;
  }

  const today = DateTime.fromJSDate(now, { zone: SCHEDULE_TIMEZONE }).toISODate();
  const startDate = DateTime.fromISO(schedule.startDate, { zone: SCHEDULE_TIMEZONE });
  if (!startDate.isValid || startDate.toISODate() !== schedule.startDate) {
    throw fieldError("startDate", "날짜를 선택해 주세요.");
  }
  if (today !== null && schedule.startDate < today) {
    throw fieldError("startDate", PAST_START_DATE_MESSAGE);
  }
  try {
    getNextDispatchPreview(schedule, now);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new ApplicationError("VALIDATION_ERROR", { message: INVALID_SCHEDULE_MESSAGE, cause: error });
    }
    throw error;
  }
}

async function consumeDraft(
  transaction: RepositoryTransaction,
  draftId: string,
  actorUserId: string,
  now: Date,
): Promise<NotificationDraftRecord> {
  const consumed = await transaction.drafts.consumeAvailable(draftId, actorUserId);
  if (consumed) {
    return consumed;
  }
  const draft = await transaction.drafts.findById(draftId);
  // Another user's draft is reported exactly like a missing one.
  if (!draft || draft.ownerId !== actorUserId) {
    throw new ApplicationError("NOT_FOUND", { message: DRAFT_UNAVAILABLE_MESSAGE });
  }
  if (draft.consumedAt) {
    throw new ApplicationError("CONFLICT", { message: DRAFT_CONSUMED_MESSAGE });
  }
  if (draft.expiresAt.getTime() <= now.getTime()) {
    throw new ApplicationError("VALIDATION_ERROR", { message: DRAFT_EXPIRED_MESSAGE });
  }
  throw new ApplicationError("NOT_FOUND", { message: DRAFT_UNAVAILABLE_MESSAGE });
}

function fieldError(field: ScheduleFieldName, message: string): ApplicationError {
  return new ApplicationError("VALIDATION_ERROR", { message, fieldErrors: { [field]: [message] } });
}

function scheduleValidationError(error: z.ZodError): ApplicationError {
  const fieldErrors: Record<string, string[]> = {};
  let draftIssue = false;
  for (const issue of error.issues) {
    const [root, field] = issue.path;
    if (root === "draftId") {
      draftIssue = true;
      continue;
    }
    const key = field === "at" ? "oneTimeDate" : typeof field === "string" ? field : undefined;
    if (key) {
      (fieldErrors[key] ??= []).push(issue.message);
    }
  }
  if (draftIssue) {
    return new ApplicationError("NOT_FOUND", { message: DRAFT_UNAVAILABLE_MESSAGE });
  }
  return new ApplicationError("VALIDATION_ERROR", {
    message: INVALID_SCHEDULE_MESSAGE,
    fieldErrors,
  });
}
