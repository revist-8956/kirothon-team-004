import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ConfirmDispatchResult } from "@/app/actions/inbox";
import { formatCardMeta, formatConfirmedAt } from "./format";
import { ReceivedDispatchCard, type ReceivedDispatchCardData } from "./received-dispatch-card";

const groupCard: ReceivedDispatchCardData = {
  dispatchId: "dispatch-1",
  sentence: "저녁 약 챙겨 먹기",
  mode: "GROUP",
  meta: "우리 가족 · 엄마 · 매일 3회차 · 11/16(월) 오후 9:00",
  confirmedAt: null,
  statusHref: "/notifications/n-1/status?dispatchId=dispatch-1",
};

const personalCard: ReceivedDispatchCardData = {
  dispatchId: "dispatch-2",
  sentence: "오늘 약속 기억하기",
  mode: "PERSONAL",
  meta: "개인 · 민수 · 일회성 · 11/13(금) 오전 11:30",
  confirmedAt: null,
};

function confirmAction(result: ConfirmDispatchResult) {
  return vi.fn<(dispatchId: string) => Promise<ConfirmDispatchResult>>(async () => result);
}

describe("ReceivedDispatchCard", () => {
  it("shows confirm and response-status actions on an unconfirmed group card without confirming", () => {
    const action = confirmAction({ ok: true, data: { confirmedAt: "2026-11-16T12:05:00.000Z" } });
    render(<ReceivedDispatchCard card={groupCard} confirmAction={action} />);

    expect(screen.getByRole("heading", { name: "저녁 약 챙겨 먹기" })).toBeVisible();
    expect(screen.getByText("미확인")).toBeVisible();
    expect(screen.getByText(groupCard.meta)).toBeVisible();
    expect(screen.getByRole("button", { name: "확인" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "응답 현황" })).toHaveAttribute("href", groupCard.statusHref);
    expect(action).not.toHaveBeenCalled();
  });

  it("gives a personal recipient only the confirm button and no response status", () => {
    render(<ReceivedDispatchCard card={personalCard} confirmAction={confirmAction({ ok: true, data: { confirmedAt: "" } })} />);

    expect(screen.getByRole("button", { name: "확인" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "응답 현황" })).toBeNull();
    expect(screen.getByText("개인 알림은 내 확인 여부만 볼 수 있어요.")).toBeVisible();
  });

  it("shows the first confirmation time instead of the button once confirmed", () => {
    const confirmedAt = "2026-11-09T05:40:00.000Z";
    render(
      <ReceivedDispatchCard
        card={{ ...groupCard, confirmedAt }}
        confirmAction={confirmAction({ ok: true, data: { confirmedAt } })}
      />,
    );

    expect(screen.getByText("확인")).toBeVisible();
    expect(screen.getByRole("button", { name: "11/9 오후 2:40 확인함" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "응답 현황" })).toBeVisible();
  });

  it("confirms only on click and then shows the confirmation time", async () => {
    const user = userEvent.setup();
    const action = confirmAction({ ok: true, data: { confirmedAt: "2026-11-13T03:00:00.000Z" } });
    render(<ReceivedDispatchCard card={personalCard} confirmAction={action} />);

    await user.click(screen.getByRole("button", { name: "확인" }));

    expect(action).toHaveBeenCalledExactlyOnceWith("dispatch-2");
    expect(await screen.findByRole("button", { name: "11/13 오후 12:00 확인함" })).toBeDisabled();
  });

  it("keeps the card unconfirmed and shows the reason when confirming fails", async () => {
    const user = userEvent.setup();
    const action = confirmAction({
      ok: false,
      code: "FORBIDDEN",
      message: "이 알림을 확인할 권한이 없어요.",
      requestId: "request-1",
    });
    render(<ReceivedDispatchCard card={groupCard} confirmAction={action} />);

    await user.click(screen.getByRole("button", { name: "확인" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("이 알림을 확인할 권한이 없어요."));
    expect(screen.getByText("미확인")).toBeVisible();
    expect(screen.getByRole("button", { name: "확인" })).toBeEnabled();
  });
});

describe("inbox card formatting", () => {
  it("formats the round line in Asia/Seoul", () => {
    expect(
      formatCardMeta({
        mode: "GROUP",
        groupName: "운영팀",
        senderNickname: "민수",
        scheduleKind: "RECURRING",
        recurrence: "WEEKLY",
        sequence: 3,
        sentAt: new Date("2026-11-16T00:00:00.000Z"),
      }),
    ).toBe("운영팀 · 민수 · 매주 3회차 · 11/16(월) 오전 9:00");
    expect(
      formatCardMeta({
        mode: "PERSONAL",
        groupName: null,
        senderNickname: "태호",
        scheduleKind: "ONE_TIME",
        recurrence: null,
        sequence: 1,
        sentAt: new Date("2026-11-13T02:30:00.000Z"),
      }),
    ).toBe("개인 · 태호 · 일회성 · 11/13(금) 오전 11:30");
    expect(formatConfirmedAt(new Date("2026-11-08T15:05:00.000Z"))).toBe("11/9 오전 12:05 확인함");
  });
});
