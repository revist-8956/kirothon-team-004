import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { processDueSlot } from "./dispatch-scheduler";
import { confirmDispatch } from "./inbox";
import { getNotificationStatus } from "./notification-status";
import { createInMemoryRepositories, type InMemoryRepositories } from "../tests/support/in-memory-repositories";

async function sendRound(model: InMemoryRepositories, notificationId: string, day: number) {
  const effectiveDate = `2026-03-${String(day).padStart(2, "0")}`;
  model.tick();
  return processDueSlot(model.repositories, {
    notificationId,
    slot: { effectiveDate, sourceDates: [effectiveDate], dueAtUtc: new Date(`${effectiveDate}T00:00:00.000Z`) },
  });
}

/** A personal notification from a sender to `recipientCount` friends, with `rounds` rounds sent. */
async function personalFixture(recipientCount: number, rounds: number) {
  const model = createInMemoryRepositories();
  const sender = model.setup.user("발신자");
  const recipients = Array.from({ length: recipientCount }, (_, index) => model.setup.user(`수신자${index}`));
  const outsider = model.setup.user("제3자");
  const notificationId = model.setup.notification({ senderId: sender, mode: "PERSONAL", targets: recipients });
  const dispatchIds: string[] = [];
  for (let day = 2; day < 2 + rounds; day += 1) {
    const outcome = await sendRound(model, notificationId, day);
    if (outcome.kind === "SENT") dispatchIds.push(outcome.dispatchId);
  }
  return { model, sender, recipients, outsider, notificationId, dispatchIds };
}

describe("confirmation properties", () => {
  // Feature: personal-group-notifications, Property 20: 확인의 명시성 및 멱등성
  // **Validates: Requirements 13.1, 13.2, 13.3, 13.4**
  it("Property 20: reading never confirms; the first confirm stores a time and later confirms return it", async () => {
    type Op = { kind: "read" | "confirm"; recipient: number; round: number };
    const opArbitrary = fc.record({
      kind: fc.constantFrom<"read" | "confirm">("read", "confirm"),
      recipient: fc.nat(2),
      round: fc.nat(2),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(opArbitrary, { maxLength: 30 }), async (ops: Op[]) => {
        const { model, recipients, notificationId, dispatchIds } = await personalFixture(3, 3);
        const firstConfirmedAt = new Map<string, number>();

        for (const op of ops) {
          const recipient = recipients[op.recipient]!;
          const dispatchId = dispatchIds[op.round]!;
          const key = `${dispatchId}:${recipient}`;
          const before = model.snapshot().recipients;
          model.tick();

          if (op.kind === "read") {
            await getNotificationStatus(model.repositories, recipient, notificationId, dispatchId);
            expect(model.snapshot().recipients).toEqual(before);
            continue;
          }
          const result = await confirmDispatch(model.repositories, recipient, dispatchId);
          const known = firstConfirmedAt.get(key);
          if (known === undefined) {
            expect(result.firstConfirmation).toBe(true);
            firstConfirmedAt.set(key, result.confirmedAt.getTime());
          } else {
            expect(result.firstConfirmation).toBe(false);
            expect(result.confirmedAt.getTime()).toBe(known);
          }
        }

        // Exactly the confirmed (round, recipient) pairs have a time, and it is the first one.
        for (const row of model.snapshot().recipients) {
          const known = firstConfirmedAt.get(`${row.dispatchId}:${row.recipientId}`);
          expect(row.confirmedAt?.getTime()).toBe(known);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: personal-group-notifications, Property 21: 무권한 확인의 원자적 비변경
  // **Validates: Requirements 13.5, 13.6**
  it("Property 21: a non-recipient or a member who left is refused and nothing changes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat(2),
        fc.array(fc.nat(3), { maxLength: 4 }),
        fc.constantFrom<"outsider" | "sender" | "left">("outsider", "sender", "left"),
        async (round, preConfirmed, actorKind) => {
          const model = createInMemoryRepositories();
          const sender = model.setup.user("엄마");
          const members = [0, 1, 2, 3].map((index) => model.setup.user(`가족${index}`));
          const outsider = model.setup.user("밖");
          const group = model.setup.group("우리 가족", sender);
          for (const user of [sender, ...members]) model.setup.join(group, user);
          const notificationId = model.setup.notification({ senderId: sender, mode: "GROUP", groupId: group });
          const dispatchIds: string[] = [];
          for (let day = 2; day < 5; day += 1) {
            const outcome = await sendRound(model, notificationId, day);
            if (outcome.kind === "SENT") dispatchIds.push(outcome.dispatchId);
          }
          const dispatchId = dispatchIds[round]!;
          for (const index of preConfirmed) {
            await confirmDispatch(model.repositories, members[index]!, dispatchId);
          }
          let actor = outsider;
          if (actorKind === "sender") actor = sender;
          if (actorKind === "left") {
            actor = members[0]!;
            model.setup.leave(group, actor);
          }
          const before = model.snapshot().recipients;

          await expect(confirmDispatch(model.repositories, actor, dispatchId)).rejects.toMatchObject({ code: "FORBIDDEN" });
          expect(model.snapshot().recipients).toEqual(before);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("response status properties", () => {
  // Feature: personal-group-notifications, Property 22: 응답 집계 정확성
  // **Validates: Requirements 14.2, 14.6, 14.7**
  it("Property 22: totals and confirmed counts come only from the selected round's rows", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }), { minLength: 1, maxLength: 4 }),
        fc.nat(3),
        async (confirmVectors, selectedIndex) => {
          const { model, sender, recipients, notificationId, dispatchIds } = await personalFixture(4, confirmVectors.length);
          for (const [round, vector] of confirmVectors.entries()) {
            for (const [index, confirmed] of vector.entries()) {
              if (confirmed) await confirmDispatch(model.repositories, recipients[index]!, dispatchIds[round]!);
            }
          }
          const selected = selectedIndex % confirmVectors.length;

          const status = await getNotificationStatus(model.repositories, sender, notificationId, dispatchIds[selected]);
          if (status.kind !== "VISIBLE" || !status.selected) throw new Error("expected a selected round");

          const vector = confirmVectors[selected]!;
          expect(status.selected.recipientCount).toBe(vector.length);
          expect(status.selected.confirmedCount).toBe(vector.filter(Boolean).length);
          expect(status.selected.recipients.filter((row) => row.confirmedAt !== null)).toHaveLength(vector.filter(Boolean).length);
          for (const [index, round] of status.rounds.entries()) {
            expect(round.recipientCount).toBe(confirmVectors[index]!.length);
            expect(round.confirmedCount).toBe(confirmVectors[index]!.filter(Boolean).length);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: personal-group-notifications, Property 23: 개인 응답 현황의 역할별 최소 projection
  // **Validates: Requirements 15.1, 15.2, 15.3**
  it("Property 23: the sender sees every row, a recipient only their own, anyone else nothing", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), fc.nat(4), async (recipientCount, viewerIndex) => {
        const { model, sender, recipients, outsider, notificationId } = await personalFixture(recipientCount, 2);

        const senderView = await getNotificationStatus(model.repositories, sender, notificationId);
        if (senderView.kind !== "VISIBLE") throw new Error("sender must see the status");
        expect(new Set(senderView.selected!.recipients.map((row) => row.recipientId))).toEqual(new Set(recipients));

        const viewer = recipients[viewerIndex % recipientCount]!;
        const recipientView = await getNotificationStatus(model.repositories, viewer, notificationId);
        if (recipientView.kind !== "VISIBLE") throw new Error("recipient must see their own row");
        expect(recipientView.selected!.recipients).toEqual([
          expect.objectContaining({ recipientId: viewer, isViewer: true }),
        ]);
        expect(recipientView.rounds.every((round) => round.recipientCount === 1)).toBe(true);

        expect(await getNotificationStatus(model.repositories, outsider, notificationId)).toEqual({ kind: "FORBIDDEN" });
      }),
      { numRuns: 100 },
    );
  });

  // Feature: personal-group-notifications, Property 24: 그룹 회차 조회 권한의 필요충분 조건
  // **Validates: Requirements 16.1, 16.2, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9**
  it("Property 24: group responses are visible only to current members for rounds sent since their latest join", async () => {
    type Event = { kind: "send" } | { kind: "join" } | { kind: "leave" };
    const eventArbitrary: fc.Arbitrary<Event> = fc.oneof(
      fc.constant({ kind: "send" as const }),
      fc.constant({ kind: "join" as const }),
      fc.constant({ kind: "leave" as const }),
    );

    await fc.assert(
      fc.asyncProperty(fc.array(eventArbitrary, { minLength: 1, maxLength: 12 }), fc.boolean(), async (events, viewerIsSender) => {
        const model = createInMemoryRepositories();
        const sender = model.setup.user("엄마");
        const other = model.setup.user("아빠");
        const viewer = viewerIsSender ? sender : model.setup.user("현우");
        const group = model.setup.group("우리 가족", sender);
        model.setup.join(group, sender);
        model.setup.join(group, other);
        const notificationId = model.setup.notification({ senderId: sender, mode: "GROUP", groupId: group });
        let day = 2;

        for (const event of events) {
          const active = model.snapshot().memberships.some((row) => row.groupId === group && row.userId === viewer && row.leftAt === null);
          if (event.kind === "send") {
            await sendRound(model, notificationId, day);
            day += 1;
          } else if (event.kind === "join" && !active) {
            model.setup.join(group, viewer);
          } else if (event.kind === "leave" && active && viewer !== sender) {
            model.setup.leave(group, viewer);
          }
        }

        const snapshot = model.snapshot();
        const latestJoin = snapshot.memberships
          .filter((row) => row.groupId === group && row.userId === viewer && row.leftAt === null)
          .sort((left, right) => right.joinedAt.getTime() - left.joinedAt.getTime())[0];
        const status = await getNotificationStatus(model.repositories, viewer, notificationId);

        if (!latestJoin) {
          expect(status).toEqual({ kind: "FORBIDDEN" });
          return;
        }
        if (status.kind !== "VISIBLE") throw new Error("a current member must see the status");
        for (const round of status.rounds) {
          const dispatch = snapshot.dispatches.find((row) => row.id === round.dispatchId)!;
          const allowed = dispatch.sentAt.getTime() >= latestJoin.joinedAt.getTime();
          expect(round.viewable).toBe(allowed);
          if (!allowed) {
            // Metadata only: no counts for rounds before the latest join.
            expect(round.recipientCount).toBeUndefined();
            const direct = await getNotificationStatus(model.repositories, viewer, notificationId, round.dispatchId);
            expect(direct).toMatchObject({ selection: "UNAVAILABLE", selected: null });
          }
        }
      }),
      { numRuns: 150 },
    );
  });
});
