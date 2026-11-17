import type { InboxCardRecord } from "@/application/repositories";
import { SCHEDULE_TIMEZONE } from "@/domain/schedule";

function kstParts(instant: Date): { month: number; day: number; weekday: string; time: string } {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIMEZONE,
    month: "numeric",
    day: "numeric",
  }).formatToParts(instant);
  const values = new Map(date.map((part) => [part.type, part.value]));
  return {
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    weekday: new Intl.DateTimeFormat("ko-KR", { timeZone: SCHEDULE_TIMEZONE, weekday: "short" }).format(instant),
    time: new Intl.DateTimeFormat("ko-KR", {
      timeZone: SCHEDULE_TIMEZONE,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(instant),
  };
}

/** "11/16(월) 오전 9:00" in Asia/Seoul. */
export function formatSentAt(instant: Date): string {
  const { month, day, weekday, time } = kstParts(instant);
  return `${month}/${day}(${weekday}) ${time}`;
}

/** "11/9 오후 2:40 확인함" in Asia/Seoul. */
export function formatConfirmedAt(instant: Date): string {
  const { month, day, time } = kstParts(instant);
  return `${month}/${day} ${time} 확인함`;
}

const recurrenceLabels = { DAILY: "매일", WEEKLY: "매주", MONTHLY: "매월" } as const;

/** "운영팀 · 민수 · 매주 3회차 · 11/16(월) 오전 9:00", or "개인 · 태호 · 일회성 · …". */
export function formatCardMeta(
  card: Pick<
    InboxCardRecord,
    "mode" | "groupName" | "senderNickname" | "scheduleKind" | "recurrence" | "sequence" | "sentAt"
  >,
): string {
  const target = card.mode === "GROUP" ? (card.groupName ?? "그룹") : "개인";
  const round =
    card.scheduleKind === "ONE_TIME" || !card.recurrence
      ? "일회성"
      : `${recurrenceLabels[card.recurrence]} ${card.sequence}회차`;
  return [target, card.senderNickname, round, formatSentAt(card.sentAt)].join(" · ");
}
