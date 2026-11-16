import type { ComponentProps } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const testState = {
  push: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: testState.push }),
}));
vi.mock("@/app/actions/notifications", () => ({
  createNotificationDraftAction: vi.fn(),
}));

import type { CreateNotificationDraftState } from "@/app/actions/notifications";

import { ComposeForm } from "./compose-form";

const friends = [
  { id: "11111111-1111-4111-8111-111111111111", nickname: "지수", email: "jisoo@example.com" },
  { id: "22222222-2222-4222-8222-222222222222", nickname: "유나", email: "yuna@example.com" },
] as const;
const groups = [
  { id: "33333333-3333-4333-8333-333333333333", name: "운영팀", memberCount: 4, latestDispatchSentAt: null },
  { id: "44444444-4444-4444-8444-444444444444", name: "기획팀", memberCount: 2, latestDispatchSentAt: null },
] as const;

function renderCompose(overrides: Partial<ComponentProps<typeof ComposeForm>> = {}) {
  return render(
    <ComposeForm
      friends={friends}
      groups={groups}
      groupRecipientPreviews={[
        { groupId: groups[0].id, recipientNicknames: ["지수", "유나", "현우"] },
        { groupId: groups[1].id, recipientNicknames: ["태호"] },
      ]}
      initialMode="PERSONAL"
      {...overrides}
    />,
  );
}

describe("ComposeForm", () => {
  it("renders one sentence input, personal checkboxes, and switches delivery modes without losing selections", async () => {
    const user = userEvent.setup();
    renderCompose();

    const sentence = screen.getByRole("textbox", { name: "어떤 알림을 보낼까요?" });
    await user.type(sentence, "회의 자료를 제출해 주세요");
    await user.click(screen.getByRole("checkbox", { name: /지수/ }));
    await user.click(screen.getByRole("radio", { name: "그룹" }));

    expect(sentence).toHaveValue("회의 자료를 제출해 주세요");
    expect(screen.getByRole("radio", { name: /운영팀/ })).not.toBeChecked();

    await user.click(screen.getByRole("radio", { name: /운영팀/ }));
    expect(screen.getByText("수신 예정 3명 · 지수, 유나, 현우")).toBeVisible();
    expect(screen.getByText("발송 시점의 구성원 중 나를 제외한 전원이 받아요. 반복 알림은 회차마다 다시 정해져요.")).toBeVisible();

    await user.click(screen.getByRole("radio", { name: "개인" }));
    expect(screen.getByRole("checkbox", { name: /지수/ })).toBeChecked();
    expect(sentence).toHaveValue("회의 자료를 제출해 주세요");
  });

  it("preselects the group requested by group detail and permits only one group radio target", () => {
    renderCompose({ initialMode: "GROUP", initialGroupId: groups[1].id });

    expect(screen.getByRole("radio", { name: /기획팀/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /운영팀/ })).not.toBeChecked();
    expect(screen.getByText("수신 예정 1명 · 태호")).toBeVisible();
  });

  it("shows useful empty recipient states", async () => {
    const user = userEvent.setup();
    renderCompose({ friends: [], groups: [] });

    expect(screen.getByRole("heading", { name: "아직 친구가 없어요" })).toBeVisible();
    expect(screen.getByRole("link", { name: "친구 추가하기" })).toHaveAttribute("href", "/friends");

    await user.click(screen.getByRole("radio", { name: "그룹" }));

    expect(screen.getByRole("heading", { name: "아직 속한 그룹이 없어요" })).toBeVisible();
    expect(screen.getByRole("link", { name: "그룹으로 이동" })).toHaveAttribute("href", "/groups");
  });

  it("keeps input and selected recipients after server validation fails", async () => {
    const user = userEvent.setup();
    const createDraftAction = vi.fn(async (
      _previousState: CreateNotificationDraftState,
      _formData: FormData,
    ): Promise<CreateNotificationDraftState> => ({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "수신 대상을 한 명 이상 선택해 주세요.",
      fieldErrors: { recipientIds: ["수신 대상을 한 명 이상 선택해 주세요."] },
      requestId: "request-1",
    }));
    renderCompose({ createDraftAction });

    const sentence = screen.getByRole("textbox", { name: "어떤 알림을 보낼까요?" });
    await user.type(sentence, "회의 자료를 제출해 주세요");
    await user.click(screen.getByRole("checkbox", { name: /유나/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));

    await waitFor(() => {
      expect(screen.getAllByRole("alert")[0]).toHaveTextContent("수신 대상을 한 명 이상 선택해 주세요.");
    });

    expect(sentence).toHaveValue("회의 자료를 제출해 주세요");
    expect(screen.getByRole("checkbox", { name: /유나/ })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "어떤 알림을 보낼까요?" })).toHaveFocus();
  });

  it("moves to schedule with the server-issued draft key after a valid submission", async () => {
    const user = userEvent.setup();
    const createDraftAction = vi.fn(async (
      _previousState: CreateNotificationDraftState,
      _formData: FormData,
    ): Promise<CreateNotificationDraftState> => ({
      ok: true,
      data: { draftId: "draft-123" },
    }));
    renderCompose({ createDraftAction });

    await user.type(screen.getByRole("textbox", { name: "어떤 알림을 보낼까요?" }), "점검을 확인해 주세요");
    await user.click(screen.getByRole("checkbox", { name: /지수/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));

    await waitFor(() => {
      expect(testState.push).toHaveBeenCalledWith("/notifications/new/schedule?draftId=draft-123");
    });

    const submitted = createDraftAction.mock.calls[0]![1];
    expect(submitted.get("mode")).toBe("PERSONAL");
    expect(submitted.getAll("recipientIds")).toEqual([friends[0].id]);
  });
});
