import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  appRoutes,
  ComposeHeader,
  GroupDetailHeader,
  groupDetailRoute,
  notificationStatusRoute,
  TabbedPageLayout,
} from ".";

describe("protected navigation", () => {
  it("renders the four primary tabs with the selected route identified", () => {
    render(
      <TabbedPageLayout current="inbox">
        <p>받은 알림 내용</p>
      </TabbedPageLayout>,
    );

    const navigation = screen.getByRole("navigation", { name: "주요 메뉴" });
    expect(screen.getByText("받은 알림 내용")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "받은 알림" })).toHaveAttribute("href", "/inbox");
    expect(screen.getByRole("link", { name: "보낸 알림" })).toHaveAttribute("href", "/sent");
    expect(screen.getByRole("link", { name: "친구" })).toHaveAttribute("href", "/friends");
    expect(screen.getByRole("link", { name: "그룹" })).toHaveAttribute("href", "/groups");
    expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(screen.getByRole("link", { name: "받은 알림" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("uses the screen transition table for compose and group-detail headers", () => {
    const { rerender } = render(<ComposeHeader />);

    expect(screen.getByRole("link", { name: "알림 작성을 닫고 받은 알림으로" })).toHaveAttribute(
      "href",
      appRoutes.inbox,
    );
    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    rerender(<ComposeHeader step="2 / 2" backTo={appRoutes.composeGroup} />);
    expect(screen.getByRole("link", { name: "알림 작성으로 돌아가기" })).toHaveAttribute(
      "href",
      appRoutes.composeGroup,
    );

    rerender(<GroupDetailHeader title="운영팀" />);
    expect(screen.getByRole("link", { name: "그룹 목록으로 돌아가기" })).toHaveAttribute(
      "href",
      appRoutes.groups,
    );
  });

  it("encodes dynamic route identifiers as path segments", () => {
    expect(groupDetailRoute("team/a")).toBe("/groups/team%2Fa");
    expect(notificationStatusRoute("note/a")).toBe("/notifications/note%2Fa/status");
  });
});
