import { z } from "zod";

export const GROUP_NAME_ERROR_MESSAGE = "그룹 이름을 입력해 주세요.";
export const NOTIFICATION_SENTENCE_ERROR_MESSAGE = "알림 문장을 입력해 주세요.";

export function normalizeRequiredText(value: string): string {
  return value.trim();
}

export function isNonBlankText(value: string): boolean {
  return normalizeRequiredText(value).length > 0;
}

function normalizedNonBlankSchema(message: string) {
  return z.string().transform(normalizeRequiredText).refine(isNonBlankText, { message });
}

export const groupNameSchema = normalizedNonBlankSchema(GROUP_NAME_ERROR_MESSAGE);
export const notificationSentenceSchema = normalizedNonBlankSchema(
  NOTIFICATION_SENTENCE_ERROR_MESSAGE,
);
