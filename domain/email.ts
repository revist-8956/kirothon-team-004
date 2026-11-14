import { z } from "zod";

export const EMAIL_ERROR_MESSAGE = "유효한 이메일 주소를 입력해 주세요.";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Applies the service's intentionally narrow basic email format:
 * no whitespace, exactly one @, and at least two non-empty domain labels.
 */
export function isBasicEmailFormat(email: string): boolean {
  const candidate = email.trim();

  if (/\s/u.test(candidate)) {
    return false;
  }

  const parts = candidate.split("@");
  if (parts.length !== 2) {
    return false;
  }

  const [localPart, domain] = parts;
  if (!localPart || !domain) {
    return false;
  }

  const domainLabels = domain.split(".");
  return domainLabels.length >= 2 && domainLabels.every((label) => label.length > 0);
}

export const emailSchema = z
  .string()
  .refine(isBasicEmailFormat, { message: EMAIL_ERROR_MESSAGE })
  .transform(normalizeEmail);
