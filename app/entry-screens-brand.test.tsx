import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  getOptionalUser: vi.fn(),
  requireUser: vi.fn(),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`redirect:${destination}`);
  }),
}));

vi.mock("@/application/authentication", () => ({
  getOptionalUser: testState.getOptionalUser,
  requireUser: testState.requireUser,
}));
vi.mock("next/navigation", () => ({ redirect: testState.redirect }));
vi.mock("./login/actions", () => ({ signInWithGoogle: vi.fn() }));
vi.mock("@/app/actions/profile", () => ({ updateNickname: vi.fn() }));

import LoginPage from "./login/page";
import ProfileSetupPage from "./profile/setup/page";

/** Document-order position of an element, for asserting the content order. */
function order(...elements: Element[]): number[] {
  const all = [...document.body.querySelectorAll("*")];
  return elements.map((element) => all.indexOf(element));
}

describe("entry screens with the brand block", () => {
  beforeEach(() => {
    testState.getOptionalUser.mockReset();
    testState.requireUser.mockReset();
    testState.redirect.mockClear();
  });

  it("shows the brand block above the unchanged login copy, button and return path", async () => {
    testState.getOptionalUser.mockResolvedValue(null);

    render(await LoginPage({ searchParams: Promise.resolve({ returnTo: "/groups" }) }));

    const brand = document.querySelector("[data-brand-container]")!;
    const name = screen.getByText("했냥?");
    const heading = screen.getByRole("heading", { level: 1 });
    const button = screen.getByRole("button", { name: "Google 계정으로 계속하기" });
    expect(heading).toHaveTextContent("알림을 보내고누가 확인했는지한눈에 보세요");
    expect(screen.getByText("개인이나 그룹에 보내고, 회차별로 확인 현황을 볼 수 있어요.")).toBeVisible();
    expect(screen.getByText("처음 로그인하면 계정이 자동으로 만들어져요.")).toBeVisible();
    expect(screen.getByDisplayValue("/groups")).toHaveAttribute("name", "returnTo");
    const [brandIndex, nameIndex, headingIndex, buttonIndex] = order(brand, name, heading, button);
    expect(brandIndex).toBeLessThan(nameIndex!);
    expect(nameIndex).toBeLessThan(headingIndex!);
    expect(headingIndex).toBeLessThan(buttonIndex!);
    // The old bell icon is gone.
    expect(document.querySelector("svg path[d^='M6 16h12']")).toBeNull();
  });

  it("keeps the login failure message and the signed-in redirect", async () => {
    testState.getOptionalUser.mockResolvedValue(null);
    render(await LoginPage({ searchParams: Promise.resolve({ error: "OAuthCallback" }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("Google 로그인에 실패했습니다. 다시 시도해 주세요.");

    testState.getOptionalUser.mockResolvedValue({ id: "u", nickname: "", nicknameRequired: true });
    await expect(LoginPage({ searchParams: Promise.resolve({ returnTo: "//evil.example" }) })).rejects.toThrow(
      "redirect:/profile/setup?returnTo=%2Finbox",
    );
  });

  it("shows the brand block above the unchanged profile setup copy and form", async () => {
    testState.requireUser.mockResolvedValue({ id: "u", nickname: "민", nicknameRequired: true });

    render(await ProfileSetupPage({ searchParams: Promise.resolve({ returnTo: "/friends" }) }));

    const brand = document.querySelector("[data-brand-container]")!;
    const eyebrow = screen.getByText("프로필 설정");
    const heading = screen.getByRole("heading", { level: 1, name: "사용할 닉네임을 정해 주세요" });
    const input = screen.getByRole("textbox", { name: "닉네임" });
    const submit = screen.getByRole("button", { name: "시작하기" });
    expect(screen.getByText("했냥?")).toBeVisible();
    expect(screen.getByText("Google 프로필 이름은 표시 이름으로 사용할 수 없어요.")).toBeVisible();
    expect(input).toHaveValue("민");
    const positions = order(brand, eyebrow, heading, input, submit);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(testState.requireUser).toHaveBeenCalledWith("/friends", { allowNicknameRequired: true });
  });

  it("still sends a user who already has a nickname to the return path", async () => {
    testState.requireUser.mockResolvedValue({ id: "u", nickname: "민수", nicknameRequired: false });
    await expect(ProfileSetupPage({ searchParams: Promise.resolve({ returnTo: "/sent" }) })).rejects.toThrow("redirect:/sent");
  });
});
