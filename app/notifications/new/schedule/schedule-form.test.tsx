import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ScheduleForm, type ScheduleSubmission } from "./schedule-form";

const fridayMorning = new Date("2025-05-02T01:00:00.000Z");

describe("ScheduleForm", () => {
  it("renders one-time fields and recurrence-specific daily, weekly, and monthly controls", async () => {
    const user = userEvent.setup();
    render(<ScheduleForm now={fridayMorning} initialStartDate="2025-05-02" />);

    expect(screen.getByRole("radio", { name: "반복" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "매주" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("group", { name: "요일" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "일회성" }));
    expect(screen.getByLabelText("날짜")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("발송 시각")).toHaveAttribute("type", "time");
    expect(screen.queryByRole("switch", { name: "주말 제외" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "반복" }));
    await user.click(screen.getByRole("radio", { name: "매일" }));
    expect(screen.queryByRole("group", { name: "요일" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("매월 날짜")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "매월" }));
    expect(screen.getByLabelText("매월 날짜")).toHaveAttribute("min", "1");
    expect(screen.getByLabelText("매월 날짜")).toHaveAttribute("max", "31");
  });

  it("explains weekend deferral and previews the next KST dispatch", () => {
    render(
      <ScheduleForm
        now={fridayMorning}
        initialRecurrence="WEEKLY"
        initialStartDate="2025-05-02"
        initialWeekday={6}
        initialLocalTime="09:00"
        initialSkipWeekend
      />,
    );

    expect(screen.getByRole("switch", { name: "주말 제외" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("매주 토요일 회차는 다음 월요일에 보내요.")).toBeVisible();
    expect(screen.getByText(/다음 발송 5월 5일\(월\) 오전 9:00/)).toBeVisible();
  });

  it("submits a validated one-time KST schedule with its compose draft ID", async () => {
    const user = userEvent.setup();
    const onSchedule = vi.fn<(submission: ScheduleSubmission) => { ok: true }>(() => ({ ok: true }));
    render(
      <ScheduleForm
        draftId="draft-123"
        initialKind="ONE_TIME"
        initialStartDate="2025-05-03"
        initialLocalTime="10:30"
        now={fridayMorning}
        onSchedule={onSchedule}
      />,
    );

    await user.click(screen.getByRole("button", { name: "발송 예약하기" }));

    await waitFor(() => expect(onSchedule).toHaveBeenCalledOnce());
    expect(onSchedule).toHaveBeenCalledWith({
      draftId: "draft-123",
      schedule: { kind: "ONE_TIME", at: "2025-05-03T01:30:00.000Z" },
    });
  });

  it("rejects past one-time schedules without invoking the reservation flow", async () => {
    const user = userEvent.setup();
    const onSchedule = vi.fn();
    render(
      <ScheduleForm
        initialKind="ONE_TIME"
        initialStartDate="2025-05-01"
        initialLocalTime="09:00"
        now={fridayMorning}
        onSchedule={onSchedule}
      />,
    );

    await user.click(screen.getByRole("button", { name: "발송 예약하기" }));

    expect(screen.getByRole("alert")).toHaveTextContent("과거 시각에는 예약할 수 없어요.");
    expect(onSchedule).not.toHaveBeenCalled();
  });

  it("validates a monthly day and preserves values when the reservation flow returns draft errors", async () => {
    const user = userEvent.setup();
    const onSchedule = vi.fn(async () => ({
      ok: false as const,
      message: "예약 초안이 만료되었거나 접근 권한이 없어요.",
    }));
    render(
      <ScheduleForm
        draftId="expired-draft"
        initialRecurrence="MONTHLY"
        initialStartDate="2025-05-02"
        initialLocalTime="10:00"
        now={fridayMorning}
        onSchedule={onSchedule}
      />,
    );

    const dayInput = screen.getByLabelText("매월 날짜");
    fireEvent.change(dayInput, { target: { value: "32" } });
    await user.click(screen.getByRole("button", { name: "발송 예약하기" }));
    expect(screen.getByRole("alert")).toHaveTextContent("매월 날짜는 1일부터 31일 사이여야 해요.");
    expect(onSchedule).not.toHaveBeenCalled();

    fireEvent.change(dayInput, { target: { value: "31" } });
    await user.click(screen.getByRole("button", { name: "발송 예약하기" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("예약 초안이 만료되었거나 접근 권한이 없어요.");
    });
    expect(screen.getByLabelText("매월 날짜")).toHaveValue(31);
  });
});
