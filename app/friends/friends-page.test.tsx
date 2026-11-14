import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/friends", () => ({
  addFriend: vi.fn(),
}));

import type { AddFriendState } from "@/app/actions/friends";

import { FriendsPage } from "./friends-page";

const invalidEmailState: AddFriendState = {
  ok: false,
  code: "VALIDATION_ERROR",
  message: "유효한 이메일 주소를 입력해 주세요.",
  fieldErrors: { email: ["유효한 이메일 주소를 입력해 주세요."] },
  requestId: "request-1",
};

describe("FriendsPage", () => {
  it("renders the approved add card, friend projection, and guidance", () => {
    render(
      <FriendsPage
        friends={[
          { nickname: "지수", email: "jisoo@example.com" },
          { nickname: "유나", email: "yuna@example.com" },
        ]}
      />,
    );

    expect(screen.getByRole("textbox", { name: "이메일로 친구 추가" })).toHaveAttribute(
      "placeholder",
      "friend@example.com",
    );
    expect(screen.getByRole("button", { name: "추가" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /내 친구 2/ })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "내 친구 목록" })).toHaveTextContent("지수");
    expect(screen.getByRole("list", { name: "내 친구 목록" })).toHaveTextContent(
      "yuna@example.com",
    );
    expect(screen.getByText("개인 발송은 친구 목록에 있는 사용자에게만 보낼 수 있어요.")).toBeVisible();
  });

  it("shows an actionable empty state and moves focus to the email input", async () => {
    const user = userEvent.setup();
    render(<FriendsPage friends={[]} />);

    expect(screen.getByRole("heading", { name: /내 친구 0/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "아직 친구가 없어요" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "이메일로 친구 추가" }));

    expect(screen.getByRole("textbox", { name: "이메일로 친구 추가" })).toHaveFocus();
  });

  it("keeps the typed email and returns focus to the field after an add error", async () => {
    const user = userEvent.setup();
    const addFriendAction = vi.fn(async (): Promise<AddFriendState> => invalidEmailState);
    render(<FriendsPage friends={[]} addFriendAction={addFriendAction} />);

    const emailInput = screen.getByRole("textbox", { name: "이메일로 친구 추가" });
    await user.type(emailInput, "not-an-email");
    await user.click(screen.getByRole("button", { name: "추가" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("유효한 이메일 주소를 입력해 주세요.");
    });

    expect(emailInput).toHaveValue("not-an-email");
    expect(emailInput).toHaveFocus();
    expect(emailInput).toHaveAccessibleDescription("유효한 이메일 주소를 입력해 주세요.");
    expect(addFriendAction).toHaveBeenCalledOnce();
  });

  it("announces successful friend addition feedback", async () => {
    const user = userEvent.setup();
    const addFriendAction = vi.fn(async (): Promise<AddFriendState> => ({
      ok: true,
      data: { nickname: "지수", email: "jisoo@example.com" },
      message: "친구를 추가했어요.",
    }));
    render(<FriendsPage friends={[]} addFriendAction={addFriendAction} />);

    const emailInput = screen.getByRole("textbox", { name: "이메일로 친구 추가" });
    await user.type(emailInput, "jisoo@example.com");
    await user.click(screen.getByRole("button", { name: "추가" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("친구를 추가했어요.");
    });

    expect(emailInput).toHaveValue("");
  });
});
