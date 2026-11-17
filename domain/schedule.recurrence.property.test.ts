import fc from "fast-check";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
  calculateDueSlots,
  SCHEDULE_TIMEZONE,
  type ScheduleSpec,
} from "./schedule";

type RecurringSpec = Extract<ScheduleSpec, { kind: "RECURRING" }>;
type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

type RecurrenceRule =
  | { recurrence: "DAILY" }
  | { recurrence: "WEEKLY"; weekday: Weekday }
  | { recurrence: "MONTHLY"; dayOfMonth: number };

/**
 * Years start at 1990 so that every generated date lies after the last
 * Korean daylight-saving period (1987-1988); 2000 and 2100 cover the
 * leap-century and non-leap-century rules.
 */
const generatedDateArbitrary = fc
  .tuple(
    fc.integer({ min: 1990, max: 2100 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 31 }),
  )
  .map(([year, month, requestedDay]) => {
    const firstOfMonth = DateTime.fromObject({ year, month, day: 1 }, { zone: SCHEDULE_TIMEZONE });
    const day = Math.min(requestedDay, firstOfMonth.daysInMonth ?? 28);
    return firstOfMonth.set({ day }).startOf("day");
  });

/** Leap days, month ends and year ends that a uniform generator rarely hits. */
const boundaryDateArbitrary = fc
  .constantFrom(
    "1999-12-31",
    "2000-02-28",
    "2000-02-29",
    "2023-01-31",
    "2023-02-28",
    "2024-01-29",
    "2024-01-31",
    "2024-02-28",
    "2024-02-29",
    "2024-04-30",
    "2024-12-31",
    "2025-12-31",
    "2100-02-28",
  )
  .map((value) => DateTime.fromISO(value, { zone: SCHEDULE_TIMEZONE }).startOf("day"));

const startDateArbitrary = fc.oneof(
  { weight: 3, arbitrary: generatedDateArbitrary },
  { weight: 2, arbitrary: boundaryDateArbitrary },
);

const localTimeArbitrary = fc
  .tuple(
    fc.integer({ min: 0, max: 23 }),
    fc.integer({ min: 0, max: 59 }),
    fc.integer({ min: 0, max: 59 }),
  )
  .map(([hour, minute, second]) =>
    [hour, minute, second].map((part) => String(part).padStart(2, "0")).join(":"),
  );

const recurrenceRuleArbitrary: fc.Arbitrary<RecurrenceRule> = fc.oneof(
  fc.constant<RecurrenceRule>({ recurrence: "DAILY" }),
  fc
    .integer({ min: 1, max: 7 })
    .map((weekday): RecurrenceRule => ({ recurrence: "WEEKLY", weekday: weekday as Weekday })),
  fc
    .oneof(fc.integer({ min: 1, max: 31 }), fc.constantFrom(29, 30, 31))
    .map((dayOfMonth): RecurrenceRule => ({ recurrence: "MONTHLY", dayOfMonth })),
);

function dateOnly(date: DateTime): string {
  const value = date.toISODate();
  if (value === null) {
    throw new Error("Expected a valid calendar date.");
  }

  return value;
}

/** Spec-level predicate (Requirements 10.3-10.6), checked one calendar day at a time. */
function isScheduledOn(rule: RecurrenceRule, date: DateTime): boolean {
  switch (rule.recurrence) {
    case "DAILY":
      return true;
    case "WEEKLY":
      return date.weekday === rule.weekday;
    case "MONTHLY":
      return date.day === Math.min(rule.dayOfMonth, date.daysInMonth ?? 31);
  }
}

function expectedIntervalDays(rule: RecurrenceRule): number | null {
  if (rule.recurrence === "DAILY") {
    return 1;
  }
  if (rule.recurrence === "WEEKLY") {
    return 7;
  }

  return null;
}

describe("calculateDueSlots recurrence", () => {
  // Feature: personal-group-notifications, Property 13: 반복 예정일 생성
  // **Validates: Requirements 10.3, 10.4, 10.5, 10.6**
  it("Property 13: generates exactly the DAILY, WEEKLY and MONTHLY source dates on or after the start date", () => {
    fc.assert(
      fc.property(
        startDateArbitrary,
        recurrenceRuleArbitrary,
        localTimeArbitrary,
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 1_100 }),
        (start, rule, localTime, leadDays, spanDays) => {
          const end = start.plus({ days: spanDays });
          const spec: RecurringSpec = {
            kind: "RECURRING",
            ...rule,
            startDate: dateOnly(start),
            localTime,
            skipWeekend: false,
            timezone: SCHEDULE_TIMEZONE,
          };

          // The window opens before the start date so that any date generated
          // ahead of the start date would be visible in the result.
          const fromExclusive = start.minus({ days: leadDays, milliseconds: 1 }).toUTC().toJSDate();
          const throughInclusive = end.endOf("day").toUTC().toJSDate();

          const slots = calculateDueSlots(spec, fromExclusive, throughInclusive);
          const actualDates = slots.map((slot) => slot.effectiveDate);

          const expectedDates: string[] = [];
          for (let day = start; day <= end; day = day.plus({ days: 1 })) {
            if (isScheduledOn(rule, day)) {
              expectedDates.push(dateOnly(day));
            }
          }

          expect(actualDates).toEqual(expectedDates);
          expect(slots.map((slot) => slot.sourceDates)).toEqual(expectedDates.map((date) => [date]));
          expect(actualDates.every((date) => date >= spec.startDate)).toBe(true);

          const interval = expectedIntervalDays(rule);
          const generated = actualDates.map((date) => DateTime.fromISO(date, { zone: SCHEDULE_TIMEZONE }));
          if (rule.recurrence === "DAILY") {
            expect(actualDates[0]).toBe(spec.startDate);
          }
          if (interval !== null) {
            for (let index = 1; index < generated.length; index += 1) {
              expect(generated[index].diff(generated[index - 1], "days").days).toBe(interval);
            }
          } else {
            const months = generated.map((date) => date.year * 12 + date.month);
            for (let index = 1; index < months.length; index += 1) {
              expect(months[index] - months[index - 1]).toBe(1);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
    // About 3s alone; spans up to 1,100 days exceed the 5s default when files run in parallel.
  }, 30_000);
});
