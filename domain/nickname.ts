import { z } from "zod";

export const NICKNAME_MIN_CODE_POINTS = 1;
export const NICKNAME_MAX_CODE_POINTS = 20;
export const NICKNAME_ERROR_MESSAGE = "닉네임은 1자 이상 20자 이하로 입력해 주세요.";

/** Removes surrounding Unicode whitespace without changing internal content. */
export function normalizeNickname(candidate: string): string {
  return candidate.trim();
}

/** Counts Unicode code points rather than UTF-16 code units. */
export function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length;
}

export function isValidNickname(candidate: string): boolean {
  const length = countUnicodeCodePoints(normalizeNickname(candidate));
  return length >= NICKNAME_MIN_CODE_POINTS && length <= NICKNAME_MAX_CODE_POINTS;
}

export const nicknameSchema = z
  .string()
  .transform(normalizeNickname)
  .refine(
    (nickname) => {
      const length = countUnicodeCodePoints(nickname);
      return length >= NICKNAME_MIN_CODE_POINTS && length <= NICKNAME_MAX_CODE_POINTS;
    },
    { message: NICKNAME_ERROR_MESSAGE },
  );
