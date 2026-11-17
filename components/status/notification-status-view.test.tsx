import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { NotificationStatusView } from "@/application/notification-status";
import { NotificationStatusContent, StatusAccessDenied } from "./notification-status-view";

type VisibleStatus = Extract<NotificationStatusView, { kind: "VISIBLE" }>;

const groupStatus: VisibleStatus = {
  kind: "VISIBLE",
  notification: {
    id: "11111111-1111-4111-8111-111111111111",
    sentence: "주간 회의 자료 제출",
    mode: "GROUP",
    groupName: "운영팀",
    senderNickname: "민수",
    scheduleKind: "RECURRING",
    recurrence: "WEEKLY",
    viewerIsSender: false,
  },
  rounds: [
    { dispatchId: "d1", sequence: 1, effectiveDate: "2026-11-02", viewable: false },
    { dispatchId: "d2", sequence: 2, effectiveDate: "2026-11-09", viewable: true, confirmedCount: 2, recipientCount: 3 },
    { dispatchId: "d3", sequence: 3, effectiveDate: "2026-11-16", viewable: true, confirmedCount: 0, recipientCount: 3 },
  ],
  selection: "SELECTED",
  selected: {
    dispatchId: "d2",
    sequence: 2,
    effectiveDate: "2026-11-09",
    sentAt: new Date("2026-11-09T00:00:00.000Z"),
    confirmedCount: 2,
    recipientCount: 3,
    recipients: [
      { recipientId: "u1", nickname: "지수", confirmedAt: new Date("2026-11-09T01:12:00.000Z"), isViewer: false },
      { recipientId: "u2", nickname: "유나", confirmedAt: null, isViewer: false },
      { recipientId: "u3", nickname: "현우", confirmedAt: new Date("2026-11-09T05:40:00.000Z"), isViewer: true },
    ],
  },
};

describe("NotificationStatusContent", () => {
  it("renders the round selector with unavailable rounds as non-links", () => {
    render(<NotificationStatusContent status={groupStatus} />);

    expect(screen.getByRole("heading", { level: 1, name: "주간 회의 자료 제출" })).toBeVisible();
    expect(screen.getByText("응답 현황 · 운영팀 · 민수 · 매주")).toBeVisible();
    const selector = screen.getByRole("list", { name: "발송 회차" });
    const links = within(selector).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["2회차 11/9확인 2/3", "3회차 11/16확인 0/3"]);
    expect(links[0]).toHaveAttribute("aria-current", "true");
    expect(links[1]).toHaveAttribute("href", `/notifications/${groupStatus.notification.id}/status?dispatchId=d3`);
    expect(within(selector).getByText("조회 불가").closest("[aria-disabled]")).toHaveTextContent("1회차 11/2");
    expect(screen.getByText("가입 전에 발송된 회차는 볼 수 없어요.")).toBeVisible();
  });

  it("shows the selected round tally and each recipient's response", () => {
    render(<NotificationStatusContent status={groupStatus} />);

    expect(screen.getByRole("heading", { level: 2, name: "3명 중 2명이 확인했어요" })).toBeVisible();
    expect(screen.getByText("2회차 · 11/9(월)")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "수신자 3명 중 2명 확인" })).toBeVisible();
    const rows = within(screen.getByRole("list", { name: "수신자별 응답" })).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "지지수11/9 오전 10:12확인",
      "유유나미확인",
      "현현우 (나)11/9 오후 2:40확인",
    ]);
  });

  it("shows the unavailable state without recipients for a round sent before joining", () => {
    render(<NotificationStatusContent status={{ ...groupStatus, selection: "UNAVAILABLE", selected: null }} />);

    expect(screen.getByText(/가입 전에 발송된 회차는 수신자와 응답을 볼 수 없어요/)).toBeVisible();
    expect(screen.queryByRole("list", { name: "수신자별 응답" })).toBeNull();
    expect(screen.queryByText("지수")).toBeNull();
  });

  it("explains own-row-only visibility to a personal recipient", () => {
    render(
      <NotificationStatusContent
        status={{
          ...groupStatus,
          notification: { ...groupStatus.notification, mode: "PERSONAL", groupName: null },
          rounds: [groupStatus.rounds[1]!],
        }}
      />,
    );

    expect(screen.getByText("응답 현황 · 개인 · 민수 · 매주")).toBeVisible();
    expect(screen.getByText("개인 알림은 내 확인 여부만 볼 수 있어요.")).toBeVisible();
  });
});

describe("StatusAccessDenied", () => {
  it("shows only the access-denied state", () => {
    render(<StatusAccessDenied />);

    expect(screen.getByText("조회 권한 없음")).toBeVisible();
    expect(screen.getByRole("link", { name: "받은 알림으로 이동" })).toHaveAttribute("href", "/inbox");
  });
});
