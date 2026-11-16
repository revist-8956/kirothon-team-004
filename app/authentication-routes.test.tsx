import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  getOptionalUser: vi.fn(),
  requireUser: vi.fn(),
  getInvite: vi.fn(),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`redirect:${destination}`);
  }),
  signInWithGoogle: vi.fn(),
}));

vi.mock("@/application/authentication", () => ({
  getOptionalUser: testState.getOptionalUser,
  requireUser: testState.requireUser,
}));
vi.mock("@/application/invites", () => ({ getInvite: testState.getInvite }));
vi.mock("@/infrastructure/prisma-repositories", () => ({ repositories: {} }));
vi.mock("@/components/groups", () => ({ InviteScreen: () => <div>invite screen</div> }));
vi.mock("@/components/navigation", () => ({ appRoutes: { inbox: "/inbox" } }));
vi.mock("next/navigation", () => ({ redirect: testState.redirect }));
vi.mock("./login/actions", () => ({ signInWithGoogle: testState.signInWithGoogle }));

import FriendsLayout from "./friends/layout";
import GroupsLayout from "./groups/layout";
import InboxLayout from "./inbox/layout";
import InvitePage from "./invite/[token]/page";
import LoginPage from "./login/page";
import NotificationsLayout from "./notifications/layout";
import SentLayout from "./sent/layout";

const protectedLayouts = [
  ["friends", FriendsLayout, "/friends"],
  ["groups", GroupsLayout, "/groups"],
  ["inbox", InboxLayout, "/inbox"],
  ["sent", SentLayout, "/sent"],
  ["notification compose", NotificationsLayout, "/notifications/new"],
] as const;

describe("authentication routes", () => {
  beforeEach(() => {
    testState.getOptionalUser.mockReset();
    testState.requireUser.mockReset();
    testState.getInvite.mockReset();
    testState.redirect.mockClear();
    testState.signInWithGoogle.mockReset();
  });

  it("shows an OAuth failure or cancellation message on the Google login screen without user data", async () => {
    testState.getOptionalUser.mockResolvedValue(null);

    render(await LoginPage({ searchParams: Promise.resolve({ error: "OAuthCallback" }) }));

    expect(screen.getByRole("alert")).toHaveTextContent("Google 로그인에 실패했습니다. 다시 시도해 주세요.");
    expect(screen.getByRole("button", { name: "Google 계정으로 계속하기" })).toBeEnabled();
    expect(screen.getByDisplayValue("/inbox")).toHaveAttribute("type", "hidden");
  });

  it("returns an unauthenticated invite visitor to the exact invite path after login", async () => {
    testState.getOptionalUser.mockResolvedValue(null);
    testState.getInvite.mockResolvedValue({
      groupId: "group-1",
      groupName: "운영팀",
      inviterNickname: "민수",
      currentMemberCount: 2,
      alreadyMember: false,
      returnTo: "/invite/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12",
    });

    await expect(
      InvitePage({ params: Promise.resolve({ token: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12" }) }),
    ).rejects.toThrow(
      "redirect:/login?returnTo=%2Finvite%2FabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12",
    );

    expect(testState.getInvite).toHaveBeenCalledWith(
      {},
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12",
      undefined,
    );
  });

  it.each(protectedLayouts)("protects the %s route at its layout boundary", async (_name, Layout, route) => {
    testState.requireUser.mockResolvedValue({ id: "user-1", nickname: "민수", nicknameRequired: false });

    const rendered = await Layout({ children: <p>protected content</p> });
    render(rendered as ReactNode);

    expect(testState.requireUser).toHaveBeenCalledWith(route);
    expect(screen.getByText("protected content")).toBeVisible();
  });
});
