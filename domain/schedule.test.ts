import fc from "fast-check";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import {
  calculateDueSlots,
  getNextDispatchPreview,
  SCHEDULE_TIMEZONE,
  type ScheduleSpec,
} from "./schedule";

function utc(value: string): Date {
  return new Date(value);
}

const recurringBase: Omit<Extract<ScheduleSpec, { kind: "RECURRING" }>, "recurrence" | "startDate" | "localTime" | "skipWeekend"> = {
  kind: "RECURRING",
  timezone: SCHEDULE_TIMEZONE,
};

const sourceDateArbitrary = fc
  .integer({
    min: Date.UTC(2000, 0, 1),
    max: Date.UTC(2030, 11, 31, 23, 59, 59, 999),
  })
  .map((timestamp) =>
    DateTime.fromMillis(timestamp, { zone: SCHEDULE_TIMEZONE }).toISODate()!,
  );

function firstWeekdayOnOrAfter(sourceDate: string): string {
  let candidate = DateTime.fromISO(sourceDate, { zone: SCHEDULE_TIMEZONE }).startOf("day");

  while (candidate.weekday > 5) {
    candidate = candidate.plus({ days: 1 });
  }

  return candidate.toISODate()!;
}

function calculateSourceSlot(sourceDate: string, skipWeekend: boolean) {
  const source = DateTime.fromISO(sourceDate, { zone: SCHEDULE_TIMEZONE }).startOf("day");
  const expectedEffectiveDate = skipWeekend
    ? firstWeekdayOnOrAfter(sourceDate)
    : sourceDate;
  const effective = DateTime.fromISO(expectedEffectiveDate, { zone: SCHEDULE_TIMEZONE }).endOf("day");
  const slots = calculateDueSlots(
    {
      ...recurringBase,
      recurrence: "DAILY",
      startDate: sourceDate,
      localTime: "09:00",
      skipWeekend,
    },
    source.minus({ days: 1 }).toUTC().toJSDate(),
    effective.toUTC().toJSDate(),
  );

  return slots.find((slot) => slot.sourceDates.includes(sourceDate));
}

type CalendarDate = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
};

const generatedCalendarDateArbitrary = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 31 }),
  )
  .map(([year, month, requestedDay]): CalendarDate => ({
    year,
    month,
    day: Math.min(requestedDay, DateTime.utc(year, month).daysInMonth ?? 31),
  }));

const boundaryCalendarDateArbitrary = fc.constantFrom<CalendarDate>(
  { year: 2023, month: 12, day: 31 },
  { year: 2024, month: 1, day: 31 },
  { year: 2024, month: 2, day: 28 },
  { year: 2024, month: 2, day: 29 },
  { year: 2024, month: 12, day: 31 },
  { year: 2025, month: 2, day: 28 },
);

const calendarDateArbitrary = fc.oneof(
  { weight: 3, arbitrary: generatedCalendarDateArbitrary },
  { weight: 2, arbitrary: boundaryCalendarDateArbitrary },
);

function kstDate(date: CalendarDate): DateTime {
  return DateTime.fromObject(date, { zone: SCHEDULE_TIMEZONE }).startOf("day");
}

function slotsForDateWindow(
  spec: Extract<ScheduleSpec, { kind: "RECURRING" }>,
  start: DateTime,
  through: DateTime,
) {
  return calculateDueSlots(
    spec,
    start.minus({ days: 1 }).set({ hour: 12 }).toUTC().toJSDate(),
    through.set({ hour: 23, minute: 59, second: 59, millisecond: 999 }).toUTC().toJSDate(),
  );
}

const kstStartDateArbitrary = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([year, month, day]) => DateTime.fromObject({ year, month, day }, { zone: SCHEDULE_TIMEZONE }).startOf("day"));

function dateOnly(date: DateTime): string {
  const value = date.toISODate();
  if (value === null) {
    throw new Error("Expected a valid calendar date.");
  }

  return value;
}

function effectiveDateForWeekendSkipping(sourceDate: DateTime): DateTime {
  if (sourceDate.weekday === 6) {
    return sourceDate.plus({ days: 2 });
  }
  if (sourceDate.weekday === 7) {
    return sourceDate.plus({ days: 1 });
  }

  return sourceDate;
}

describe("calculateDueSlots", () => {
  it("creates a one-time slot from an instant using its Asia/Seoul date", () => {
    const slots = calculateDueSlots(
      { kind: "ONE_TIME", at: "2025-05-01T17:30:00.000Z" },
      utc("2025-05-01T00:00:00.000Z"),
      utc("2025-05-02T00:00:00.000Z"),
    );

    expect(slots).toEqual([
      {
        effectiveDate: "2025-05-02",
        sourceDates: ["2025-05-02"],
        dueAtUtc: utc("2025-05-01T17:30:00.000Z"),
      },
    ]);
  });

  it("moves weekend daily dates to Monday and merges all sources for that effective date", () => {
    const slots = calculateDueSlots(
      {
        ...recurringBase,
        recurrence: "DAILY",
        startDate: "2025-05-02",
        localTime: "09:00",
        skipWeekend: true,
      },
      utc("2025-05-01T00:00:00.000Z"),
      utc("2025-05-05T23:59:59.999Z"),
    );

    expect(slots.map(({ effectiveDate, sourceDates, dueAtUtc }) => ({
      effectiveDate,
      sourceDates,
      dueAtUtc: dueAtUtc.toISOString(),
    }))).toEqual([
      {
        effectiveDate: "2025-05-02",
        sourceDates: ["2025-05-02"],
        dueAtUtc: "2025-05-02T00:00:00.000Z",
      },
      {
        effectiveDate: "2025-05-05",
        sourceDates: ["2025-05-03", "2025-05-04", "2025-05-05"],
        dueAtUtc: "2025-05-05T00:00:00.000Z",
      },
    ]);
  });

  it("starts weekly recurrence on the first requested weekday at or after its start date", () => {
    const slots = calculateDueSlots(
      {
        ...recurringBase,
        recurrence: "WEEKLY",
        startDate: "2025-05-01",
        localTime: "14:15:30",
        weekday: 6,
        skipWeekend: false,
      },
      utc("2025-05-01T00:00:00.000Z"),
      utc("2025-05-11T00:00:00.000Z"),
    );

    expect(slots.map((slot) => [slot.effectiveDate, slot.dueAtUtc.toISOString()])).toEqual([
      ["2025-05-03", "2025-05-03T05:15:30.000Z"],
      ["2025-05-10", "2025-05-10T05:15:30.000Z"],
    ]);
  });

  it("uses each month's final date when its requested monthly day does not exist", () => {
    const slots = calculateDueSlots(
      {
        ...recurringBase,
        recurrence: "MONTHLY",
        startDate: "2024-01-01",
        localTime: "09:00",
        dayOfMonth: 31,
        skipWeekend: false,
      },
      utc("2024-01-01T00:00:00.000Z"),
      utc("2024-05-01T00:00:00.000Z"),
    );

    expect(slots.map((slot) => slot.effectiveDate)).toEqual([
      "2024-01-31",
      "2024-02-29",
      "2024-03-31",
      "2024-04-30",
    ]);
  });

  // Feature: personal-group-notifications, Property 15: 같은 발송일의 회차 합치기
  // **Validates: Requirements 10.11**
  it("creates one slot per effective date and preserves each due source date exactly once", () => {
    fc.assert(
      fc.property(
        kstStartDateArbitrary,
        fc.integer({ min: 2, max: 90 }),
        (startDate, durationInDays) => {
          const fromExclusive = startDate.minus({ days: 1 }).toUTC();
          const throughInclusive = startDate.plus({ days: durationInDays }).endOf("day").toUTC();
          const slots = calculateDueSlots(
            {
              ...recurringBase,
              recurrence: "DAILY",
              startDate: dateOnly(startDate),
              localTime: "09:00",
              skipWeekend: true,
            },
            fromExclusive.toJSDate(),
            throughInclusive.toJSDate(),
          );

          const expectedSourceDatesByEffectiveDate = new Map<string, string[]>();
          for (
            let sourceDate = startDate;
            sourceDate <= throughInclusive.setZone(SCHEDULE_TIMEZONE).startOf("day");
            sourceDate = sourceDate.plus({ days: 1 })
          ) {
            const effectiveDate = effectiveDateForWeekendSkipping(sourceDate);
            const dueAt = effectiveDate.set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toUTC();

            if (dueAt > fromExclusive && dueAt <= throughInclusive) {
              const effectiveDateValue = dateOnly(effectiveDate);
              const sourceDates = expectedSourceDatesByEffectiveDate.get(effectiveDateValue) ?? [];
              sourceDates.push(dateOnly(sourceDate));
              expectedSourceDatesByEffectiveDate.set(effectiveDateValue, sourceDates);
            }
          }

          expect(new Set(slots.map((slot) => slot.effectiveDate)).size).toBe(slots.length);
          expect(
            slots.flatMap((slot) => slot.sourceDates).sort(),
          ).toEqual(
            [...expectedSourceDatesByEffectiveDate.values()].flat().sort(),
          );

          for (const slot of slots) {
            expect(new Set(slot.sourceDates).size).toBe(slot.sourceDates.length);
            expect(slot.sourceDates).toEqual(expectedSourceDatesByEffectiveDate.get(slot.effectiveDate));
          }
        },
      ),
      { numRuns: 100 },
    );
  });
  // Feature: personal-group-notifications, Property 14: 주말 이동의 첫 평일 규칙
  // **Validates: Requirements 10.8, 10.9, 10.10, 10.12**
  it("keeps source dates when disabled and otherwise uses the first weekday on or after them", () => {
    fc.assert(
      fc.property(sourceDateArbitrary, (sourceDate) => {
        const unshiftedSlot = calculateSourceSlot(sourceDate, false);
        const shiftedSlot = calculateSourceSlot(sourceDate, true);
        const expectedShiftedDate = firstWeekdayOnOrAfter(sourceDate);

        expect(unshiftedSlot).toBeDefined();
        expect(unshiftedSlot?.effectiveDate).toBe(sourceDate);

        expect(shiftedSlot).toBeDefined();
        expect(shiftedSlot?.effectiveDate).toBe(expectedShiftedDate);

        const effectiveWeekday = DateTime.fromISO(expectedShiftedDate, {
          zone: SCHEDULE_TIMEZONE,
        }).weekday;
        expect(effectiveWeekday).toBeGreaterThanOrEqual(1);
        expect(effectiveWeekday).toBeLessThanOrEqual(5);
      }),
      { numRuns: 100 },
    );
  });
});

describe("Property 13: recurring source-date generation", () => {
  // Feature: personal-group-notifications, Property 13: 반복 예정일 생성
  // **Validates: Requirements 10.3, 10.4, 10.5, 10.6**
  it("generates daily source dates from the start date at one-day intervals", () => {
    fc.assert(
      fc.property(calendarDateArbitrary, fc.integer({ min: 0, max: 400 }), (startDate, days) => {
        const start = kstDate(startDate);
        const expectedDates = Array.from(
          { length: days + 1 },
          (_, offset) => dateOnly(start.plus({ days: offset })),
        );
        const slots = slotsForDateWindow(
          {
            ...recurringBase,
            recurrence: "DAILY",
            startDate: dateOnly(start),
            localTime: "12:00",
            skipWeekend: false,
          },
          start,
          start.plus({ days }),
        );

        expect(slots.map((slot) => slot.effectiveDate)).toEqual(expectedDates);
        expect(slots.map((slot) => slot.sourceDates)).toEqual(expectedDates.map((date) => [date]));
      }),
      { numRuns: 100 },
    );
  });

  it("generates weekly source dates on the selected weekday at seven-day intervals", () => {
    fc.assert(
      fc.property(
        calendarDateArbitrary,
        fc.integer({ min: 1, max: 7 }),
        fc.integer({ min: 0, max: 730 }),
        (startDate, weekday, days) => {
          const start = kstDate(startDate);
          const through = start.plus({ days });
          const first = start.plus({ days: (weekday - start.weekday + 7) % 7 });
          const expectedDates: string[] = [];

          for (let date = first; date <= through; date = date.plus({ weeks: 1 })) {
            expectedDates.push(dateOnly(date));
          }

          const slots = slotsForDateWindow(
            {
              ...recurringBase,
              recurrence: "WEEKLY",
              startDate: dateOnly(start),
              localTime: "12:00",
              weekday: weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7,
              skipWeekend: false,
            },
            start,
            through,
          );

          expect(slots.map((slot) => slot.effectiveDate)).toEqual(expectedDates);
          expect(slots.map((slot) => slot.sourceDates)).toEqual(expectedDates.map((date) => [date]));
          expect(slots.every((slot) => kstDate({
            year: Number(slot.effectiveDate.slice(0, 4)),
            month: Number(slot.effectiveDate.slice(5, 7)),
            day: Number(slot.effectiveDate.slice(8, 10)),
          }).weekday === weekday)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("uses min(dayOfMonth, last day) for every monthly source date", () => {
    fc.assert(
      fc.property(
        calendarDateArbitrary,
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: 0, max: 36 }),
        (startDate, dayOfMonth, monthCount) => {
          const start = kstDate(startDate);
          const lastMonth = start.startOf("month").plus({ months: monthCount });
          const expectedDates: string[] = [];

          for (let month = start.startOf("month"); month <= lastMonth; month = month.plus({ months: 1 })) {
            const scheduledDate = month.set({ day: Math.min(dayOfMonth, month.daysInMonth ?? 31) });
            if (scheduledDate >= start) {
              expectedDates.push(dateOnly(scheduledDate));
            }
          }

          const slots = slotsForDateWindow(
            {
              ...recurringBase,
              recurrence: "MONTHLY",
              startDate: dateOnly(start),
              localTime: "12:00",
              dayOfMonth,
              skipWeekend: false,
            },
            start,
            lastMonth.endOf("month"),
          );

          expect(slots.map((slot) => slot.effectiveDate)).toEqual(expectedDates);
          expect(slots.map((slot) => slot.sourceDates)).toEqual(expectedDates.map((date) => [date]));
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("getNextDispatchPreview", () => {
  it("returns the next merged KST dispatch with its UTC instant and weekday", () => {
    const preview = getNextDispatchPreview(
      {
        ...recurringBase,
        recurrence: "DAILY",
        startDate: "2025-05-02",
        localTime: "09:00",
        skipWeekend: true,
      },
      utc("2025-05-02T01:00:00.000Z"),
    );

    expect(preview).toEqual({
      effectiveDate: "2025-05-05",
      sourceDates: ["2025-05-03", "2025-05-04", "2025-05-05"],
      dueAtUtc: utc("2025-05-05T00:00:00.000Z"),
      dueAtUtcIso: "2025-05-05T00:00:00.000Z",
      weekday: 1,
    });
  });

  it("returns null when a one-time dispatch has already elapsed", () => {
    expect(
      getNextDispatchPreview(
        { kind: "ONE_TIME", at: "2025-05-01T17:30:00.000Z" },
        utc("2025-05-01T17:30:00.000Z"),
      ),
    ).toBeNull();
  });
});
