/** A user who can be written into one dispatch's recipient snapshot. */
export interface RecipientCandidate {
  readonly userId: string;
  readonly nickname: string;
}

export type RecipientSnapshotDecision =
  | { readonly kind: "SEND"; readonly recipients: readonly RecipientCandidate[] }
  | { readonly kind: "SKIP"; readonly reason: "SENDER_NOT_MEMBER" | "NO_RECIPIENTS" };

function uniqueByUser(candidates: readonly RecipientCandidate[]): RecipientCandidate[] {
  const seen = new Set<string>();
  const result: RecipientCandidate[] = [];
  for (const candidate of candidates) {
    if (!seen.has(candidate.userId)) {
      seen.add(candidate.userId);
      result.push(candidate);
    }
  }
  return result;
}

/**
 * Personal notifications always use the targets fixed at reservation time
 * (Requirement 8.2). The sender is never a recipient.
 */
export function decidePersonalRecipients(
  senderId: string,
  targets: readonly RecipientCandidate[],
): RecipientSnapshotDecision {
  const recipients = uniqueByUser(targets).filter((target) => target.userId !== senderId);
  return recipients.length === 0
    ? { kind: "SKIP", reason: "NO_RECIPIENTS" }
    : { kind: "SEND", recipients };
}

/**
 * Group recipients are the current members at dispatch time minus the
 * sender (Requirements 9.6, 9.9). A sender who is no longer a member, or a
 * group with nobody else in it, produces a skipped slot (9.7, 9.8).
 */
export function decideGroupRecipients(
  senderId: string,
  currentMembers: readonly RecipientCandidate[],
): RecipientSnapshotDecision {
  const members = uniqueByUser(currentMembers);
  if (!members.some((member) => member.userId === senderId)) {
    return { kind: "SKIP", reason: "SENDER_NOT_MEMBER" };
  }
  const recipients = members.filter((member) => member.userId !== senderId);
  return recipients.length === 0
    ? { kind: "SKIP", reason: "NO_RECIPIENTS" }
    : { kind: "SEND", recipients };
}
