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

/** Years start at 1990, after the last Korean daylight-saving period (1987-1988). */
const startDateArbitrary = fc
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

/** WEEKLY on Saturday/Sunday and month-end MONTHLY rules are weighted up so weekend shifts are frequent. */
const recurrenceRuleArbitrary: fc.Arbitrary<RecurrenceRule> = fc.oneof(
  fc.constant<RecurrenceRule>({ recurrence: "DAILY" }),
  fc
    .oneof(fc.integer({ min: 1, max: 7 }), fc.constantFrom(6, 7))
    .map((weekday): RecurrenceRule => ({ recurrence: "WEEKLY", weekday: weekday as Weekday })),
  fc
    .oneof(fc.integer({ min: 1, max: 31 }), fc.constantFrom(29, 30, 31))
    .map((dayOfMonth): RecurrenceRule => ({ recurrence: "MONTHLY", dayOfMonth })),
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

function dateOnly(date: DateTime): string {
  const value = date.toISODate();
  if (value === null) {
    throw new Error("Expected a valid calendar date.");
  }

  return value;
}

function kstDate(value: string): DateTime {
  return DateTime.fromISO(value, { zone: SCHEDULE_TIMEZONE }).startOf("day");
}

function isWeekday(date: DateTime): boolean {
  return date.weekday >= 1 && date.weekday <= 5;
}

/** Independent oracle: walks forward one day at a time to the first Monday-Friday date. */
function firstWeekdayOnOrAfter(sourceDate: DateTime): DateTime {
  let candidate = sourceDate;
  while (!isWeekday(candidate)) {
    candidate = candidate.plus({ days: 1 });
  }

  return candidate;
}

describe("calculateDueSlots weekend deferral", () => {
  // Feature: personal-group-notifications, Property 14: 주말 이동의 첫 평일 규칙
  // **Validates: Requirements 10.8, 10.9, 10.10, 10.12**
  it("Property 14: moves each source date to the first weekday on or after it only when skipWeekend is on", () => {
    fc.assert(
      fc.property(
        startDateArbitrary,
        recurrenceRuleArbitrary,
        localTimeArbitrary,
        fc.boolean(),
        fc.integer({ min: 35, max: 400 }),
        (start, rule, localTime, skipWeekend, spanDays) => {
          const spec: RecurringSpec = {
            kind: "RECURRING",
            ...rule,
            startDate: dateOnly(start),
            localTime,
            skipWeekend,
            timezone: SCHEDULE_TIMEZONE,
          };

          const fromExclusive = start.minus({ milliseconds: 1 }).toUTC().toJSDate();
          const throughInclusive = start.plus({ days: spanDays }).endOf("day").toUTC().toJSDate();

          const slots = calculateDueSlots(spec, fromExclusive, throughInclusive);

          // A span of at least 35 days always contains a DAILY, WEEKLY and MONTHLY source date.
          expect(slots.length).toBeGreaterThan(0);

          for (const slot of slots) {
            const effective = kstDate(slot.effectiveDate);
            expect(slot.sourceDates.length).toBeGreaterThan(0);

            for (const sourceDateValue of slot.sourceDates) {
              const source = kstDate(sourceDateValue);
              const shiftDays = effective.diff(source, "days").days;

              if (!skipWeekend) {
                // Requirement 10.8: with the option off the source date is the dispatch date.
                expect(slot.effectiveDate).toBe(sourceDateValue);
                continue;
              }

              // Requirement 10.12: on or after the source date, at most two days later, on Monday-Friday.
              expect(isWeekday(effective)).toBe(true);
              expect(shiftDays).toBeGreaterThanOrEqual(0);
              expect(shiftDays).toBeLessThanOrEqual(2);

              if (isWeekday(source)) {
                // Requirement 10.10: a weekday source date is kept unchanged.
                expect(slot.effectiveDate).toBe(sourceDateValue);
              }

              // Requirements 10.9, 10.12: the earliest weekday on or after the source date.
              expect(slot.effectiveDate).toBe(dateOnly(firstWeekdayOnOrAfter(source)));
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
