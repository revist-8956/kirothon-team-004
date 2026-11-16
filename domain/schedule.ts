import { DateTime } from "luxon";

export const SCHEDULE_TIMEZONE = "Asia/Seoul" as const;

export type Recurrence = "DAILY" | "WEEKLY" | "MONTHLY";

export type ScheduleSpec =
  | {
      kind: "ONE_TIME";
      /** An ISO-8601 instant. Offset-less values are interpreted as UTC. */
      at: string;
    }
  | {
      kind: "RECURRING";
      recurrence: Recurrence;
      /** Calendar date in Asia/Seoul, formatted as YYYY-MM-DD. */
      startDate: string;
      /** Wall-clock time in Asia/Seoul, formatted as HH:mm or HH:mm:ss. */
      localTime: string;
      weekday?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
      dayOfMonth?: number;
      skipWeekend: boolean;
      timezone: typeof SCHEDULE_TIMEZONE;
    };

export type DueSlot = {
  /** The actual Asia/Seoul date on which the notification is sent. */
  effectiveDate: string;
  /** Scheduled Asia/Seoul dates that result in this effective date. */
  sourceDates: string[];
  /** The effective date and local schedule time, represented as a UTC instant. */
  dueAtUtc: Date;
};

/** A UI-ready projection for the next scheduled dispatch. */
export type NextDispatchPreview = DueSlot & {
  /** ISO-8601 representation of dueAtUtc for transport and rendering. */
  dueAtUtcIso: string;
  /** The Asia/Seoul weekday of the effective date, where Monday is 1. */
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
};

type ParsedLocalTime = {
  hour: number;
  minute: number;
  second: number;
};

const LOCAL_TIME_PATTERN = /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)(?::(?<second>[0-5]\d))?$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function invalidSpec(message: string): never {
  throw new RangeError(`Invalid schedule specification: ${message}`);
}

function parseKstDate(value: string, fieldName: string): DateTime {
  if (!DATE_PATTERN.test(value)) {
    return invalidSpec(`${fieldName} must use YYYY-MM-DD format.`);
  }

  const date = DateTime.fromISO(value, { zone: SCHEDULE_TIMEZONE }).startOf("day");
  if (!date.isValid || date.toISODate() !== value) {
    return invalidSpec(`${fieldName} must be a valid Asia/Seoul calendar date.`);
  }

  return date;
}

function parseLocalTime(value: string): ParsedLocalTime {
  const match = LOCAL_TIME_PATTERN.exec(value);
  if (!match?.groups) {
    return invalidSpec("localTime must use HH:mm or HH:mm:ss format.");
  }

  return {
    hour: Number(match.groups.hour),
    minute: Number(match.groups.minute),
    second: Number(match.groups.second ?? "0"),
  };
}

function parseUtcInstant(value: string, fieldName: string): DateTime {
  // Supplying UTC explicitly prevents offset-less strings from inheriting process timezone.
  const instant = DateTime.fromISO(value, { zone: "utc", setZone: true });
  if (!instant.isValid) {
    return invalidSpec(`${fieldName} must be a valid ISO-8601 instant.`);
  }

  return instant.toUTC();
}

function toDateOnly(date: DateTime): string {
  const value = date.toISODate();
  if (value === null) {
    return invalidSpec("Unable to calculate a calendar date.");
  }

  return value;
}

function toUtcDate(instant: DateTime): Date {
  return instant.toUTC().toJSDate();
}

function compareDates(left: DateTime, right: DateTime): number {
  return left.toMillis() - right.toMillis();
}

function dateAtLocalTime(date: DateTime, localTime: ParsedLocalTime): DateTime {
  const result = date.set({
    hour: localTime.hour,
    minute: localTime.minute,
    second: localTime.second,
    millisecond: 0,
  });

  if (!result.isValid) {
    return invalidSpec("The effective local date and time are invalid.");
  }

  return result;
}

function effectiveDateFor(sourceDate: DateTime, skipWeekend: boolean): DateTime {
  if (!skipWeekend) {
    return sourceDate;
  }

  if (sourceDate.weekday === 6) {
    return sourceDate.plus({ days: 2 });
  }

  if (sourceDate.weekday === 7) {
    return sourceDate.plus({ days: 1 });
  }

  return sourceDate;
}

function firstWeeklyDateOnOrAfter(
  earliestDate: DateTime,
  weekday: number,
): DateTime {
  const daysUntilWeekday = (weekday - earliestDate.weekday + 7) % 7;
  return earliestDate.plus({ days: daysUntilWeekday });
}

function sourceDateWindowStart(specStartDate: DateTime, fromExclusiveUtc: DateTime): DateTime {
  const twoDaysBeforeWindow = fromExclusiveUtc
    .setZone(SCHEDULE_TIMEZONE)
    .startOf("day")
    .minus({ days: 2 });

  return compareDates(specStartDate, twoDaysBeforeWindow) > 0
    ? specStartDate
    : twoDaysBeforeWindow;
}

function recurringSourceDates(
  spec: Extract<ScheduleSpec, { kind: "RECURRING" }>,
  throughInclusiveUtc: DateTime,
  fromExclusiveUtc: DateTime,
): DateTime[] {
  if (spec.timezone !== SCHEDULE_TIMEZONE) {
    return invalidSpec(`timezone must be ${SCHEDULE_TIMEZONE}.`);
  }

  const startDate = parseKstDate(spec.startDate, "startDate");
  const earliestDate = sourceDateWindowStart(startDate, fromExclusiveUtc);
  const finalDate = throughInclusiveUtc.setZone(SCHEDULE_TIMEZONE).startOf("day");

  if (compareDates(earliestDate, finalDate) > 0) {
    return [];
  }

  if (spec.recurrence === "DAILY") {
    const result: DateTime[] = [];
    for (let date = earliestDate; compareDates(date, finalDate) <= 0; date = date.plus({ days: 1 })) {
      result.push(date);
    }
    return result;
  }

  if (spec.recurrence === "WEEKLY") {
    if (spec.weekday === undefined || !Number.isInteger(spec.weekday) || spec.weekday < 1 || spec.weekday > 7) {
      return invalidSpec("weekday must be an integer from 1 (Monday) to 7 (Sunday).");
    }

    const result: DateTime[] = [];
    for (
      let date = firstWeeklyDateOnOrAfter(earliestDate, spec.weekday);
      compareDates(date, finalDate) <= 0;
      date = date.plus({ weeks: 1 })
    ) {
      result.push(date);
    }
    return result;
  }

  if (spec.dayOfMonth === undefined || !Number.isInteger(spec.dayOfMonth) || spec.dayOfMonth < 1 || spec.dayOfMonth > 31) {
    return invalidSpec("dayOfMonth must be an integer from 1 to 31.");
  }

  const result: DateTime[] = [];
  for (
    let month = earliestDate.startOf("month");
    compareDates(month, finalDate.startOf("month")) <= 0;
    month = month.plus({ months: 1 })
  ) {
    const sourceDate = month.set({ day: Math.min(spec.dayOfMonth, month.daysInMonth ?? 31) });
    if (compareDates(sourceDate, earliestDate) >= 0 && compareDates(sourceDate, finalDate) <= 0) {
      result.push(sourceDate);
    }
  }
  return result;
}

function isInsideWindow(
  dueAtUtc: DateTime,
  fromExclusiveUtc: DateTime,
  throughInclusiveUtc: DateTime,
): boolean {
  const dueMillis = dueAtUtc.toMillis();
  return dueMillis > fromExclusiveUtc.toMillis() && dueMillis <= throughInclusiveUtc.toMillis();
}

/**
 * Calculates KST-based dispatch slots whose UTC due instant lies in
 * (fromExclusiveUtc, throughInclusiveUtc]. Multiple source dates moved to the
 * same weekday are returned as one slot with sorted, unique sourceDates.
 */
export function calculateDueSlots(
  spec: ScheduleSpec,
  fromExclusiveUtc: Date | string,
  throughInclusiveUtc: Date | string,
): DueSlot[] {
  const from = fromExclusiveUtc instanceof Date
    ? DateTime.fromJSDate(fromExclusiveUtc, { zone: "utc" })
    : parseUtcInstant(fromExclusiveUtc, "fromExclusiveUtc");
  const through = throughInclusiveUtc instanceof Date
    ? DateTime.fromJSDate(throughInclusiveUtc, { zone: "utc" })
    : parseUtcInstant(throughInclusiveUtc, "throughInclusiveUtc");

  if (!from.isValid || !through.isValid) {
    return invalidSpec("window bounds must be valid instants.");
  }
  if (through.toMillis() < from.toMillis()) {
    return invalidSpec("throughInclusiveUtc must not precede fromExclusiveUtc.");
  }

  if (spec.kind === "ONE_TIME") {
    const dueAt = parseUtcInstant(spec.at, "at");
    if (!isInsideWindow(dueAt, from, through)) {
      return [];
    }

    const kstDate = toDateOnly(dueAt.setZone(SCHEDULE_TIMEZONE));
    return [{ effectiveDate: kstDate, sourceDates: [kstDate], dueAtUtc: toUtcDate(dueAt) }];
  }

  const localTime = parseLocalTime(spec.localTime);
  const groupedSlots = new Map<string, { sourceDates: Set<string>; dueAt: DateTime }>();

  for (const sourceDate of recurringSourceDates(spec, through, from)) {
    const effectiveDate = effectiveDateFor(sourceDate, spec.skipWeekend);
    const dueAt = dateAtLocalTime(effectiveDate, localTime).toUTC();

    if (!isInsideWindow(dueAt, from, through)) {
      continue;
    }

    const effectiveDateValue = toDateOnly(effectiveDate);
    const sourceDateValue = toDateOnly(sourceDate);
    const existingSlot = groupedSlots.get(effectiveDateValue);

    if (existingSlot) {
      existingSlot.sourceDates.add(sourceDateValue);
    } else {
      groupedSlots.set(effectiveDateValue, {
        sourceDates: new Set([sourceDateValue]),
        dueAt,
      });
    }
  }

  return [...groupedSlots.entries()]
    .map(([effectiveDate, slot]) => ({
      effectiveDate,
      sourceDates: [...slot.sourceDates].sort(),
      dueAtUtc: toUtcDate(slot.dueAt),
    }))
    .sort((left, right) => left.dueAtUtc.getTime() - right.dueAtUtc.getTime());
}

/**
 * Returns the first dispatch due strictly after nowUtc, or null for an already
 * elapsed one-time notification. A 40-day window covers the longest recurrence
 * interval (monthly) plus weekend deferral.
 */
export function getNextDispatchPreview(
  spec: ScheduleSpec,
  nowUtc: Date | string,
): NextDispatchPreview | null {
  const now = nowUtc instanceof Date
    ? DateTime.fromJSDate(nowUtc, { zone: "utc" })
    : parseUtcInstant(nowUtc, "nowUtc");

  if (!now.isValid) {
    return invalidSpec("nowUtc must be a valid instant.");
  }

  const windowEnd = spec.kind === "ONE_TIME"
    ? parseUtcInstant(spec.at, "at")
    : now.plus({ days: 40 });
  const nextSlot = calculateDueSlots(spec, now.toJSDate(), windowEnd.toJSDate())[0];

  if (!nextSlot) {
    return null;
  }

  const effectiveDate = parseKstDate(nextSlot.effectiveDate, "effectiveDate");
  return {
    ...nextSlot,
    dueAtUtcIso: nextSlot.dueAtUtc.toISOString(),
    weekday: effectiveDate.weekday as NextDispatchPreview["weekday"],
  };
}
