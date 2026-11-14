import type {
  GroupDetailRecord,
  GroupListItem,
  RepositoryUnitOfWork,
} from "./repositories";

/**
 * Returns the caller's current groups with their current member counts and
 * latest group-dispatch timestamp. The repository binds the caller's current
 * membership into its database predicate.
 */
export function getGroups(
  userId: string,
  repositories: RepositoryUnitOfWork,
): Promise<readonly GroupListItem[]> {
  return repositories.transaction((transaction) => transaction.groups.listCurrentForUser(userId));
}

/**
 * Returns a group only when the caller is a current member. A null result is
 * an authorization-safe absence: callers must not render group data for it.
 */
export function getGroupDetail(
  groupId: string,
  userId: string,
  repositories: RepositoryUnitOfWork,
): Promise<GroupDetailRecord | null> {
  return repositories.transaction((transaction) =>
    transaction.groups.findDetailForCurrentMember(groupId, userId),
  );
}
