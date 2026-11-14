export const DEFAULT_RETURN_TO = "/inbox";

const VALIDATION_ORIGIN = "https://return-to.invalid";
const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * Keeps only an origin-relative path and its query string for post-login redirects.
 */
export function sanitizeReturnTo(
  candidate: string | null | undefined,
): string {
  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("#") ||
    CONTROL_CHARACTER.test(candidate)
  ) {
    return DEFAULT_RETURN_TO;
  }

  let decodedCandidate: string;
  try {
    decodedCandidate = decodeURIComponent(candidate);
  } catch {
    return DEFAULT_RETURN_TO;
  }

  if (
    CONTROL_CHARACTER.test(decodedCandidate) ||
    decodedCandidate.startsWith("//") ||
    decodedCandidate.startsWith("/\\")
  ) {
    return DEFAULT_RETURN_TO;
  }

  try {
    const parsed = new URL(candidate, VALIDATION_ORIGIN);

    if (parsed.origin !== VALIDATION_ORIGIN || parsed.hash) {
      return DEFAULT_RETURN_TO;
    }

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return DEFAULT_RETURN_TO;
  }
}
