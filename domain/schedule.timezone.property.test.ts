import fc from "fast-check";
import { IANAZone, Settings } from "luxon";
import { afterEach, describe, expect, it } from "vitest";
import {
  getNextDispatchPreview,
  SCHEDULE_TIMEZONE,
  type ScheduleSpec,
} from "./schedule";

type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

type KstDate = { year: number; month: number; day: number };
type KstTime = { hour: number; minute: number; second: number; withSeconds: boolean };

/** Everything the schedule module reports for one KST date and local time. */
type RoundTripObservation = {
  dueAtUtcIso: string;
  recurringEffectiveDate: string;
  recurringWeekday: Weekday;
  oneTimeEffectiveDate: string;
  oneTimeWeekday: Weekday;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Process time zones covering negative, positive, fractional (+05:45, -03:30),
 * half-hour DST (Lord Howe), the date-line extremes (+14, -12) and KST itself.
 */
const PROCESS_TIME_ZONES = [
  "UTC",
  "Asia/Seoul",
  "America/Los_Angeles",
  "America/St_Johns",
  "Europe/London",
  "Asia/Kathmandu",
  "Australia/Lord_Howe",
  "Pacific/Kiritimati",
  "Pacific/Pago_Pago",
  "Etc/GMT+12",
] as const;

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const formatDate = ({ year, month, day }: KstDate) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

const formatTime = ({ hour, minute, second, withSeconds }: KstTime) =>
  withSeconds ? `${pad(hour)}:${pad(minute)}:${pad(second)}` : `${pad(hour)}:${pad(minute)}`;

/** ISO weekday (Monday = 1) of a calendar date, computed without any time zone. */
const calendarWeekday = ({ year, month, day }: KstDate): Weekday =>
  (((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1) as Weekday;

/**
 * Years start at 1990 so every date lies after the last Korean daylight-saving
 * period (1987-1988); every KST wall-clock time in range therefore exists once.
 */
const generatedDateArbitrary = fc
  .tuple(
    fc.integer({ min: 1990, max: 2100 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 31 }),
  )
  .map(([year, month, day]): KstDate => ({ year, month, day: Math.min(day, daysInMonth(year, month)) }));

/** Leap days, month ends and year ends that a uniform generator rarely hits. */
const boundaryDateArbitrary = fc
  .constantFrom(
    "1990-01-01",
    "1999-12-31",
    "2000-01-01",
    "2000-02-29",
    "2024-02-29",
    "2024-12-31",
    "2025-01-01",
    "2100-02-28",
    "2100-12-31",
  )
  .map((value): KstDate => {
    const [year, month, day] = value.split("-").map(Number) as [number, number, number];
    return { year, month, day };
  });

const kstDateArbitrary = fc.oneof(
  { weight: 3, arbitrary: generatedDateArbitrary },
  { weight: 1, arbitrary: boundaryDateArbitrary },
);

/**
 * KST 09:00 is UTC midnight, so times just before and after it flip the UTC
 * calendar date; midnight and 23:59:59 are the KST day boundaries.
 */
const boundaryTimeArbitrary = fc.constantFrom(
  { hour: 0, minute: 0, second: 0 },
  { hour: 8, minute: 59, second: 59 },
  { hour: 9, minute: 0, second: 0 },
  { hour: 23, minute: 59, second: 59 },
);

const kstTimeArbitrary = fc
  .tuple(
    fc.oneof(
      { weight: 3, arbitrary: fc.record({
        hour: fc.integer({ min: 0, max: 23 }),
        minute: fc.integer({ min: 0, max: 59 }),
        second: fc.integer({ min: 0, max: 59 }),
      }) },
      { weight: 1, arbitrary: boundaryTimeArbitrary },
    ),
    fc.boolean(),
  )
  .map(([time, withSeconds]): KstTime => ({ ...time, second: withSeconds ? time.second : 0, withSeconds }));

const seoulFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SCHEDULE_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Reads an instant back as an Asia/Seoul wall clock, independently of Luxon. */
function readInSeoul(instant: Date): { date: string; time: string } {
  const parts = Object.fromEntries(
    seoulFormatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

/**
 * KST date and time -> UTC instant through a DAILY schedule starting on that
 * date, then UTC instant -> KST date through a one-time schedule at that instant.
 */
function observeRoundTrip(date: KstDate, time: KstTime): RoundTripObservation {
  const recurringSpec: ScheduleSpec = {
    kind: "RECURRING",
    recurrence: "DAILY",
    startDate: formatDate(date),
    localTime: formatTime(time),
    skipWeekend: false,
    timezone: SCHEDULE_TIMEZONE,
  };
  // Two days before the date's UTC midnight precedes the first slot whatever the offset.
  const beforeFirstSlot = new Date(Date.UTC(date.year, date.month - 1, date.day) - 2 * DAY_MS);
  const recurring = getNextDispatchPreview(recurringSpec, beforeFirstSlot);
  if (recurring === null) {
    throw new Error("A recurring schedule must always have a next dispatch.");
  }

  const oneTimeSpec: ScheduleSpec = { kind: "ONE_TIME", at: recurring.dueAtUtcIso };
  const oneTime = getNextDispatchPreview(oneTimeSpec, new Date(recurring.dueAtUtc.getTime() - 1));
  if (oneTime === null) {
    throw new Error("A future one-time schedule must have a next dispatch.");
  }

  return {
    dueAtUtcIso: recurring.dueAtUtcIso,
    recurringEffectiveDate: recurring.effectiveDate,
    recurringWeekday: recurring.weekday,
    oneTimeEffectiveDate: oneTime.effectiveDate,
    oneTimeWeekday: oneTime.weekday,
  };
}

/** January and July instants, so both standard and daylight offsets are checked. */
const OFFSET_SAMPLES = [Date.UTC(2024, 0, 15, 12), Date.UTC(2024, 6, 15, 12)] as const;

const originalTz = process.env.TZ;
const originalLuxonZone = Settings.defaultZone;

/** Switches both the process time zone and Luxon's default zone. */
function useProcessTimeZone(timeZone: string): void {
  process.env.TZ = timeZone;
  Settings.defaultZone = timeZone;
  // Guard against a vacuous test: the runtime's local offset must match the
  // requested zone. Offsets are compared because ICU may report a canonical
  // alias name (for example Asia/Katmandu for Asia/Kathmandu).
  const requestedZone = IANAZone.create(timeZone);
  expect(requestedZone.isValid).toBe(true);
  for (const sample of OFFSET_SAMPLES) {
    // `0 - x` normalizes -0 so a zero offset compares equal under Object.is.
    const expectedOffset = 0 + requestedZone.offset(sample);
    expect(0 - new Date(sample).getTimezoneOffset()).toBe(expectedOffset);
    expect(0 + Settings.defaultZone.offset(sample)).toBe(expectedOffset);
  }
}

function restoreProcessTimeZone(): void {
  if (originalTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTz;
  }
  Settings.defaultZone = originalLuxonZone;
}

describe("Property 16: Asia/Seoul 시각 왕복", () => {
  afterEach(() => {
    restoreProcessTimeZone();
  });

  /**
   * Feature: personal-group-notifications, Property 16: Asia/Seoul 시각 왕복
   * Validates: Requirements 10.13
   */
  it("restores the original KST date, local time and weekday after converting to a UTC instant", () => {
    fc.assert(
      fc.property(kstDateArbitrary, kstTimeArbitrary, (date, time) => {
        const observation = observeRoundTrip(date, time);
        const expectedDate = formatDate(date);
        const expectedWeekday = calendarWeekday(date);

        const readBack = readInSeoul(new Date(observation.dueAtUtcIso));
        expect(readBack).toEqual({
          date: expectedDate,
          time: `${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`,
        });
        expect(observation).toMatchObject({
          recurringEffectiveDate: expectedDate,
          recurringWeekday: expectedWeekday,
          oneTimeEffectiveDate: expectedDate,
          oneTimeWeekday: expectedWeekday,
        });
      }),
      { numRuns: 300 },
    );
  });

  /**
   * Feature: personal-group-notifications, Property 16: Asia/Seoul 시각 왕복
   * Validates: Requirements 10.13
   */
  it("produces the same instant, date and weekday regardless of the process time zone", () => {
    fc.assert(
      fc.property(
        kstDateArbitrary,
        kstTimeArbitrary,
        fc.constantFrom(...PROCESS_TIME_ZONES),
        (date, time, processTimeZone) => {
          try {
            useProcessTimeZone("UTC");
            const baseline = observeRoundTrip(date, time);

            useProcessTimeZone(processTimeZone);
            expect(observeRoundTrip(date, time)).toEqual(baseline);
          } finally {
            restoreProcessTimeZone();
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
