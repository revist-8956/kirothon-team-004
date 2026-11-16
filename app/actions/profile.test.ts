import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  requireUser: vi.fn(),
  update: vi.fn(),
  headers: vi.fn(),
  requestIdFromHeaders: vi.fn(),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`redirect:${destination}`);
  }),
}));

vi.mock("@/application/authentication", () => ({ requireUser: testState.requireUser }));
vi.mock("@/infrastructure/db", () => ({
  prisma: { user: { update: testState.update } },
}));
vi.mock("@/infrastructure/request-id", () => ({
  requestIdFromHeaders: testState.requestIdFromHeaders,
}));
vi.mock("next/headers", () => ({ headers: testState.headers }));
vi.mock("next/navigation", () => ({ redirect: testState.redirect }));

import { updateNickname } from "./profile";

function nicknameForm(nickname: string, returnTo = "/groups"): FormData {
  const formData = new FormData();
  formData.set("nickname", nickname);
  formData.set("returnTo", returnTo);
  return formData;
}

describe("updateNickname", () => {
  beforeEach(() => {
    testState.requireUser.mockReset();
    testState.update.mockReset();
    testState.headers.mockReset();
    testState.requestIdFromHeaders.mockReset();
    testState.redirect.mockClear();
    testState.requireUser.mockResolvedValue({ id: "user-1", nickname: "이전", nicknameRequired: true });
    testState.headers.mockResolvedValue(new Headers());
    testState.requestIdFromHeaders.mockReturnValue("request-1");
  });

  it("stores a trimmed 20-code-point nickname, clears the profile requirement, and returns to the requested route", async () => {
    const maximumLengthNickname = "😀".repeat(20);
    testState.update.mockResolvedValue({});

    await expect(updateNickname(null, nicknameForm(`  ${maximumLengthNickname}  `))).rejects.toThrow(
      "redirect:/groups",
    );

    expect(testState.requireUser).toHaveBeenCalledWith("/groups", { allowNicknameRequired: true });
    expect(testState.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { nickname: maximumLengthNickname, nicknameRequired: false },
    });
  });

  it.each(["", "\u3000\u00a0", "😀".repeat(21)])(
    "keeps the stored profile unchanged and reports a field error for invalid nickname %j",
    async (nickname) => {
      await expect(updateNickname(null, nicknameForm(nickname))).resolves.toMatchObject({
        ok: false,
        code: "VALIDATION_ERROR",
        fieldErrors: { nickname: ["닉네임은 1자 이상 20자 이하로 입력해 주세요."] },
        requestId: "request-1",
      });

      expect(testState.update).not.toHaveBeenCalled();
      expect(testState.redirect).not.toHaveBeenCalled();
    },
  );
});
