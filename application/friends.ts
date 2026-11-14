import { ApplicationError } from "./action-result";
import type { RepositoryUnitOfWork } from "./repositories";
import { EMAIL_ERROR_MESSAGE, emailSchema } from "../domain/email";

export interface AddFriendInput {
  readonly email: string;
}

/** The intentionally minimal data returned to the owner’s friend list. */
export interface FriendListItem {
  readonly nickname: string;
  readonly email: string;
}

const USER_NOT_FOUND_MESSAGE = "사용자를 찾을 수 없어요.";
const SELF_FRIEND_MESSAGE = "본인은 친구로 추가할 수 없어요.";
const DUPLICATE_FRIEND_MESSAGE = "이미 친구예요.";

/**
 * Adds one registered user to the authenticated actor's directional friend list.
 * The actor ID must be derived from the server-side session, never client input.
 */
export async function addFriend(
  repositories: RepositoryUnitOfWork,
  actorUserId: string,
  input: AddFriendInput,
): Promise<FriendListItem> {
  const parsedEmail = emailSchema.safeParse(input.email);
  if (!parsedEmail.success) {
    throw new ApplicationError("VALIDATION_ERROR", {
      message: EMAIL_ERROR_MESSAGE,
      fieldErrors: { email: [EMAIL_ERROR_MESSAGE] },
    });
  }

  return repositories.transaction(async (transaction) => {
    const user = await transaction.users.findByNormalizedEmail(parsedEmail.data);
    if (!user) {
      throw new ApplicationError("NOT_FOUND", { message: USER_NOT_FOUND_MESSAGE });
    }

    if (user.id === actorUserId) {
      throw new ApplicationError("VALIDATION_ERROR", { message: SELF_FRIEND_MESSAGE });
    }

    const existingFriendship = await transaction.friends.find(actorUserId, user.id);
    if (existingFriendship) {
      throw new ApplicationError("CONFLICT", { message: DUPLICATE_FRIEND_MESSAGE });
    }

    try {
      await transaction.friends.create(actorUserId, user.id);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        // A concurrent request created the same directional friendship first.
        throw new ApplicationError("CONFLICT", { message: DUPLICATE_FRIEND_MESSAGE });
      }
      throw error;
    }

    return { nickname: user.nickname, email: user.email };
  });
}

/**
 * Returns only the current authenticated actor's friend nickname and email fields.
 * The actor ID must be derived from the server-side session, never client input.
 */
export function getFriends(
  repositories: RepositoryUnitOfWork,
  actorUserId: string,
): Promise<readonly FriendListItem[]> {
  return repositories.transaction((transaction) => transaction.friends.listForOwner(actorUserId));
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
