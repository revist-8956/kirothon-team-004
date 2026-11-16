import { ApplicationError } from "./action-result";
import type { EnsureUserProfileInput, RepositoryUnitOfWork, UserRecord } from "./repositories";
import { isBasicEmailFormat, normalizeEmail } from "../domain/email";
import { isValidNickname, normalizeNickname } from "../domain/nickname";

/** The subset of a verified Supabase Auth user needed to prepare a profile. */
export interface SupabaseAuthIdentity {
  /** `auth.users.id`, taken only from a server-verified Supabase session. */
  readonly id: string;
  readonly email: string | null | undefined;
  /** Supabase `user_metadata`; Google supplies `full_name` and `name`. */
  readonly userMetadata?: Readonly<Record<string, unknown>> | null;
}

const INVALID_EMAIL_MESSAGE = "Google profile did not contain a valid email address.";

function metadataText(
  metadata: Readonly<Record<string, unknown>> | null | undefined,
  key: string,
): string {
  const value = metadata?.[key];
  return typeof value === "string" ? normalizeNickname(value) : "";
}

/**
 * Derives the initial profile with the same rules as the `auth.users` insert
 * trigger: a trimmed provider email, its normalized lookup key, and the Google
 * display name as a nickname candidate that requires setup when out of bounds.
 */
export function deriveInitialProfile(identity: SupabaseAuthIdentity): EnsureUserProfileInput {
  const email = (identity.email ?? "").trim();
  if (!isBasicEmailFormat(email)) {
    throw new ApplicationError("OAUTH_ERROR", { message: INVALID_EMAIL_MESSAGE });
  }

  const nickname =
    metadataText(identity.userMetadata, "full_name") || metadataText(identity.userMetadata, "name");

  return {
    id: identity.id,
    email,
    emailNormalized: normalizeEmail(email),
    nickname,
    nicknameRequired: !isValidNickname(nickname),
  };
}

/**
 * Returns the application profile of a Supabase user, creating it when the
 * database trigger has not done so. An existing profile, including a nickname
 * the user already chose, is returned unchanged.
 */
export async function prepareUserProfile(
  repositories: RepositoryUnitOfWork,
  identity: SupabaseAuthIdentity,
): Promise<UserRecord> {
  return repositories.transaction(async (transaction) => {
    const existing = await transaction.users.findById(identity.id);
    if (existing) {
      return existing;
    }

    const profile = await transaction.users.ensureProfile(deriveInitialProfile(identity));
    if (!profile) {
      // The normalized email already belongs to another profile.
      throw new ApplicationError("CONFLICT");
    }
    return profile;
  });
}
