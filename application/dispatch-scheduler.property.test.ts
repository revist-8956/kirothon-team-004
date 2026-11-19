import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { dueSlotsForNotification, processDueSlot } from "./dispatch-scheduler";
import { toNotificationScheduleFields } from "./notification-reservations";
import type { NotificationRecord } from "./repositories";
import { decideGroupRecipients } from "../domain/recipients";
import { createInMemoryRepositories } from "../tests/support/in-memory-repositories";

const userIds = ["u0", "u1", "u2", "u3", "u4", "u5"] as const;

describe("dispatch scheduler properties", () => {
  // Feature: personal-group-notifications, Property 12: 그룹 회차 수신자 집합
  // **Validates: Requirements 9.6, 9.9**
  it("Property 12: a group round's recipients are exactly the current members minus the sender", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...userIds), { maxLength: 12 }),
        fc.constantFrom(...userIds),
        (memberList, sender) => {
          const members = [...memberList, sender].map((userId) => ({ userId, nickname: userId }));
          const decision = decideGroupRecipients(sender, members);
          const expected = new Set(members.map((member) => member.userId));
          expected.delete(sender);

          if (expected.size === 0) {
            expect(decision).toEqual({ kind: "SKIP", reason: "NO_RECIPIENTS" });
            return;
          }
          expect(decision.kind).toBe("SEND");
          if (decision.kind === "SEND") {
            const recipients = decision.recipients.map((recipient) => recipient.userId);
            expect(new Set(recipients)).toEqual(expected);
            expect(recipients).toHaveLength(expected.size);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  // Feature: personal-group-notifications, Property 18: 회차 초기화와 스냅샷 독립성
  // **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5**
  it("Property 18: new rounds start unconfirmed and later confirmations or membership changes leave other rounds unchanged", async () => {
    type Step =
      | { kind: "dispatch" }
      | { kind: "confirm"; member: number; round: number }
      | { kind: "join"; member: number }
      | { kind: "leave"; member: number };
    const stepArbitrary: fc.Arbitrary<Step> = fc.oneof(
      fc.constant({ kind: "dispatch" as const }),
      fc.record({ kind: fc.constant("confirm" as const), member: fc.nat(4), round: fc.nat(6) }),
      fc.record({ kind: fc.constant("join" as const), member: fc.nat(4) }),
      fc.record({ kind: fc.constant("leave" as const), member: fc.nat(4) }),
    );

    await fc.assert(
      fc.asyncProperty(fc.array(stepArbitrary, { maxLength: 25 }), async (steps) => {
        const model = createInMemoryRepositories();
        const sender = model.setup.user("엄마");
        const members = [0, 1, 2, 3, 4].map((index) => model.setup.user(`가족${index}`));
        const group = model.setup.group("우리 가족", sender);
        model.setup.join(group, sender);
        model.setup.join(group, members[0]!);
        const notificationId = model.setup.notification({ senderId: sender, mode: "GROUP", groupId: group });
        let day = 2;

        for (const step of steps) {
          const before = model.snapshot();
          if (step.kind === "dispatch") {
            const effectiveDate = `2026-03-${String(day).padStart(2, "0")}`;
            day += 1;
            const outcome = await processDueSlot(model.repositories, {
              notificationId,
              slot: { effectiveDate, sourceDates: [effectiveDate], dueAtUtc: new Date(`${effectiveDate}T00:00:00.000Z`) },
            });
            const after = model.snapshot();
            // Existing rounds keep their recipient rows exactly.
            expect(after.recipients.filter((row) => before.recipients.some((old) => old.id === row.id))).toEqual(before.recipients);
            if (outcome.kind === "SENT") {
              const created = after.recipients.filter((row) => row.dispatchId === outcome.dispatchId);
              expect(created.every((row) => row.confirmedAt === null)).toBe(true);
              const current = after.memberships.filter((row) => row.groupId === group && row.leftAt === null).map((row) => row.userId);
              expect(new Set(created.map((row) => row.recipientId))).toEqual(new Set(current.filter((id) => id !== sender)));
            }
          } else if (step.kind === "confirm") {
            const dispatch = before.dispatches[step.round % Math.max(before.dispatches.length, 1)];
            if (!dispatch) continue;
            const member = members[step.member]!;
            const { confirmDispatch } = await import("./inbox");
            await confirmDispatch(model.repositories, member, dispatch.id).catch(() => undefined);
            const after = model.snapshot();
            // Only that member's row in that round may change.
            for (const row of after.recipients) {
              const old = before.recipients.find((candidate) => candidate.id === row.id)!;
              if (row.dispatchId !== dispatch.id || row.recipientId !== member) {
                expect(row).toEqual(old);
              }
            }
          } else {
            const member = members[step.member]!;
            if (step.kind === "join") {
              if (!before.memberships.some((row) => row.groupId === group && row.userId === member && row.leftAt === null)) {
                model.setup.join(group, member);
              }
            } else {
              model.setup.leave(group, member);
            }
            // Membership changes never touch recorded rounds.
            expect(model.snapshot().recipients).toEqual(before.recipients);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: personal-group-notifications, Property 17: 반복 중지 경계와 과거 보존
  // **Validates: Requirements 10.14, 10.15**
  it("Property 17: after a stop, no slot due later is a candidate and earlier slots are kept", () => {
    const base = toNotificationScheduleFields({
      kind: "RECURRING",
      recurrence: "DAILY",
      startDate: "2026-03-01",
      localTime: "09:00",
      skipWeekend: false,
      timezone: "Asia/Seoul",
    });
    const notification = (stoppedAt: Date | null): NotificationRecord => ({
      id: "n",
      senderId: "s",
      sentence: "약",
      mode: "PERSONAL",
      groupId: null,
      scheduleKind: "RECURRING",
      oneTimeAt: null,
      recurrence: base.recurrence ?? null,
      startDate: base.startDate ?? null,
      weekday: null,
      dayOfMonth: null,
      localTime: base.localTime ?? null,
      skipWeekend: false,
      timezone: "Asia/Seoul",
      state: stoppedAt ? "STOPPED" : "ACTIVE",
      stoppedAt,
      createdAt: new Date("2026-02-28T00:00:00.000Z"),
    });
    const windowStart = new Date("2026-02-01T00:00:00.000Z");
    const windowEnd = new Date("2026-04-15T00:00:00.000Z");

    fc.assert(
      fc.property(
        fc.date({ min: new Date("2026-02-27T00:00:00.000Z"), max: new Date("2026-04-14T00:00:00.000Z"), noInvalidDate: true }),
        (stoppedAt) => {
          const active = dueSlotsForNotification(notification(null), windowStart, windowEnd);
          const stopped = dueSlotsForNotification(notification(stoppedAt), windowStart, windowEnd);

          expect(stopped.every((slot) => slot.dueAtUtc.getTime() <= stoppedAt.getTime())).toBe(true);
          expect(stopped).toEqual(active.filter((slot) => slot.dueAtUtc.getTime() <= stoppedAt.getTime()));
        },
      ),
      { numRuns: 300 },
    );
  });
});
