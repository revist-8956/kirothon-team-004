import { describe, expect, it } from "vitest";

import { dueSlotsForNotification } from "./dispatch-scheduler";
import { toNotificationScheduleFields, toScheduleSpec } from "./notification-reservations";
import type { NotificationRecord } from "./repositories";
import { decideGroupRecipients, decidePersonalRecipients } from "../domain/recipients";
import type { ScheduleSpec } from "../domain/schedule";

const sender = { userId: "sender", nickname: "엄마" };
const dad = { userId: "dad", nickname: "아빠" };
const daughter = { userId: "daughter", nickname: "딸" };

function notification(schedule: ScheduleSpec, overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  const fields = toNotificationScheduleFields(schedule);
  return {
    id: "notification-1",
    senderId: sender.userId,
    sentence: "약 챙겨 먹기",
    mode: "PERSONAL",
    groupId: null,
    scheduleKind: fields.scheduleKind,
    oneTimeAt: fields.oneTimeAt ?? null,
    recurrence: fields.recurrence ?? null,
    startDate: fields.startDate ?? null,
    weekday: fields.weekday ?? null,
    dayOfMonth: fields.dayOfMonth ?? null,
    localTime: fields.localTime ?? null,
    skipWeekend: fields.skipWeekend ?? false,
    timezone: "Asia/Seoul",
    state: "ACTIVE",
    stoppedAt: null,
    createdAt: new Date("2026-02-28T00:00:00.000Z"),
    ...overrides,
  };
}

const daily: ScheduleSpec = {
  kind: "RECURRING",
  recurrence: "DAILY",
  startDate: "2026-03-01",
  localTime: "09:00",
  skipWeekend: false,
  timezone: "Asia/Seoul",
};

describe("recipient snapshot policy", () => {
  it("uses the fixed personal targets without the sender or duplicates", () => {
    expect(decidePersonalRecipients(sender.userId, [dad, daughter, dad, sender])).toEqual({
      kind: "SEND",
      recipients: [dad, daughter],
    });
    expect(decidePersonalRecipients(sender.userId, [])).toEqual({ kind: "SKIP", reason: "NO_RECIPIENTS" });
  });

  it("sends a group dispatch to current members except the sender", () => {
    expect(decideGroupRecipients(sender.userId, [sender, dad, daughter])).toEqual({
      kind: "SEND",
      recipients: [dad, daughter],
    });
  });

  it("skips a group slot when the sender left or nobody else is a member", () => {
    expect(decideGroupRecipients(sender.userId, [dad, daughter])).toEqual({
      kind: "SKIP",
      reason: "SENDER_NOT_MEMBER",
    });
    expect(decideGroupRecipients(sender.userId, [sender])).toEqual({ kind: "SKIP", reason: "NO_RECIPIENTS" });
  });
});

describe("dueSlotsForNotification", () => {
  it("never sends slots due at or before the notification was created", () => {
    // Created 2026-03-01 10:00 KST, after that day's 09:00 slot.
    const created = notification(daily, { createdAt: new Date("2026-03-01T01:00:00.000Z") });
    const slots = dueSlotsForNotification(
      created,
      new Date("2026-02-01T00:00:00.000Z"),
      new Date("2026-03-03T01:00:00.000Z"),
    );

    expect(slots.map((slot) => slot.effectiveDate)).toEqual(["2026-03-02", "2026-03-03"]);
  });

  it("keeps only slots due by the stop time of a stopped recurring notification", () => {
    const stopped = notification(daily, {
      state: "STOPPED",
      // 2026-03-02 12:00 KST: the 2nd's slot was due before the stop, the 3rd's after.
      stoppedAt: new Date("2026-03-02T03:00:00.000Z"),
    });
    const slots = dueSlotsForNotification(
      stopped,
      new Date("2026-02-01T00:00:00.000Z"),
      new Date("2026-03-05T01:00:00.000Z"),
    );

    expect(slots.map((slot) => slot.effectiveDate)).toEqual(["2026-03-01", "2026-03-02"]);
  });

  it("merges weekend slots into the following Monday", () => {
    const skipping = notification({ ...daily, startDate: "2026-03-06", skipWeekend: true });
    const slots = dueSlotsForNotification(
      skipping,
      new Date("2026-03-01T00:00:00.000Z"),
      new Date("2026-03-09T01:00:00.000Z"),
    );

    expect(slots.map((slot) => [slot.effectiveDate, slot.sourceDates])).toEqual([
      ["2026-03-06", ["2026-03-06"]],
      ["2026-03-09", ["2026-03-07", "2026-03-08", "2026-03-09"]],
    ]);
  });
});

describe("toScheduleSpec", () => {
  it("restores every stored schedule type", () => {
    const schedules: ScheduleSpec[] = [
      { kind: "ONE_TIME", at: "2026-03-02T12:00:00.000Z" },
      { ...daily, localTime: "21:30:00" },
      { ...daily, recurrence: "WEEKLY", weekday: 6, skipWeekend: true, localTime: "09:05:00" },
      { ...daily, recurrence: "MONTHLY", dayOfMonth: 31, localTime: "23:59:00" },
    ];

    for (const schedule of schedules) {
      expect(toScheduleSpec(notification(schedule))).toEqual(schedule);
    }
  });
});
