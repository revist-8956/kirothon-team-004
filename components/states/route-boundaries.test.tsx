import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  RouteAccessDeniedState,
  RouteErrorState,
  RouteLoadingState,
  RouteNotFoundState,
} from ".";

describe("route boundary states", () => {
  it("announces loading without rendering application data", () => {
    render(<RouteLoadingState label="친구 목록을 불러오는 중" />);

    expect(screen.getByText("친구 목록을 불러오는 중").parentElement).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.queryByText("비공개 알림 문장")).not.toBeInTheDocument();
  });

  it("retries a safe error state without exposing the error details", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<RouteErrorState reset={reset} />);
    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveAccessibleName("정보를 불러오지 못했어요");
  });

  it("links not-found and denied states to safe list routes", () => {
    const { rerender } = render(<RouteNotFoundState href="/groups" actionLabel="그룹 목록으로 이동" />);
    expect(screen.getByRole("link", { name: "그룹 목록으로 이동" })).toHaveAttribute(
      "href",
      "/groups",
    );

    rerender(<RouteAccessDeniedState />);
    expect(screen.getByRole("status")).toHaveAccessibleName("조회 권한 없음");
    expect(screen.getByRole("link", { name: "받은 알림으로 이동" })).toHaveAttribute(
      "href",
      "/inbox",
    );
    expect(screen.queryByText("비공개 알림 문장")).not.toBeInTheDocument();
  });
});
