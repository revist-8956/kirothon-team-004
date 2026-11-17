import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { StopRecurringResult } from "@/app/actions/sent";
import { formatScheduleSummary } from "./format";
import { SentNotificationCard, type SentNotificationCardData } from "./sent-notification-card";

const recurringCard: SentNotificationCardData = {
  notificationId: "n-1",
  sentence: "저녁 약 챙겨 먹기",
  targetLabel: "우리 가족",
  scheduleSummary: "매일 오후 9:00",
  latestRoundSummary: "3회차 · 확인 1/2",
  statusHref: "/notifications/n-1/status",
  canStop: true,
  stopped: false,
};

function stopAction(result: StopRecurringResult) {
  return vi.fn<(notificationId: string) => Promise<StopRecurringResult>>(async () => result);
}

describe("SentNotificationCard", () => {
  it("shows the sentence, target, schedule, latest tally and a status link", () => {
    render(<SentNotificationCard card={recurringCard} stopAction={stopAction({ ok: true, data: { stoppedAt: "" } })} />);

    expect(screen.getByRole("heading", { name: "저녁 약 챙겨 먹기" })).toBeVisible();
    expect(screen.getByText("우리 가족")).toBeVisible();
    expect(screen.getByText("매일 오후 9:00")).toBeVisible();
    expect(screen.getByText("3회차 · 확인 1/2")).toBeVisible();
    expect(screen.getByRole("link", { name: "응답 현황" })).toHaveAttribute("href", "/notifications/n-1/status");
  });

  it("stops a recurring notification only after the dialog confirmation", async () => {
    const user = userEvent.setup();
    const action = stopAction({ ok: true, data: { stoppedAt: "2026-11-17T00:00:00.000Z" } });
    render(<SentNotificationCard card={recurringCard} stopAction={action} />);

    await user.click(screen.getByRole("button", { name: "반복 중지" }));
    expect(action).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "중지" }));

    await waitFor(() => expect(action).toHaveBeenCalledExactlyOnceWith("n-1"));
    expect(await screen.findByText("매일 오후 9:00 · 중지됨")).toBeVisible();
    expect(screen.queryByRole("button", { name: "반복 중지" })).toBeNull();
  });

  it("offers no stop button for one-time or stopped notifications and shows the first-round placeholder", () => {
    render(
      <SentNotificationCard
        card={{ ...recurringCard, canStop: false, latestRoundSummary: null }}
        stopAction={stopAction({ ok: true, data: { stoppedAt: "" } })}
      />,
    );

    expect(screen.queryByRole("button", { name: "반복 중지" })).toBeNull();
    expect(screen.getByText("아직 발송된 회차가 없어요")).toBeVisible();
  });
});

describe("formatScheduleSummary", () => {
  const base = {
    oneTimeAt: null,
    weekday: null,
    dayOfMonth: null,
    localTime: "21:00:00",
    skipWeekend: false,
  };

  it("summarizes each schedule type in Asia/Seoul", () => {
    expect(formatScheduleSummary({ ...base, scheduleKind: "RECURRING", recurrence: "DAILY" })).toBe("매일 오후 9:00");
    expect(
      formatScheduleSummary({ ...base, scheduleKind: "RECURRING", recurrence: "WEEKLY", weekday: 6, localTime: "09:05:00", skipWeekend: true }),
    ).toBe("매주 토요일 오전 9:05 · 주말 제외");
    expect(
      formatScheduleSummary({ ...base, scheduleKind: "RECURRING", recurrence: "MONTHLY", dayOfMonth: 31, localTime: "00:30:00" }),
    ).toBe("매월 31일 오전 12:30");
    expect(
      formatScheduleSummary({
        ...base,
        scheduleKind: "ONE_TIME",
        recurrence: null,
        localTime: null,
        oneTimeAt: new Date("2026-11-20T12:00:00.000Z"),
      }),
    ).toBe("일회성 · 11/20(금) 오후 9:00");
  });
});
