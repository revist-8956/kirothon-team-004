import type { SentNotificationRecord } from "@/application/repositories";
import { formatSentAt, formatWallClock } from "@/components/inbox";

const weekdayNames = ["", "월", "화", "수", "목", "금", "토", "일"] as const;

/** "매주 토요일 오후 9:00 · 주말 제외", "일회성 · 11/20(금) 오후 9:00", … */
export function formatScheduleSummary(
  notification: Pick<
    SentNotificationRecord,
    "scheduleKind" | "oneTimeAt" | "recurrence" | "weekday" | "dayOfMonth" | "localTime" | "skipWeekend"
  >,
): string {
  if (notification.scheduleKind === "ONE_TIME" || !notification.recurrence) {
    return notification.oneTimeAt ? `일회성 · ${formatSentAt(notification.oneTimeAt)}` : "일회성";
  }
  const time = notification.localTime ? formatWallClock(notification.localTime) : "";
  const cadence =
    notification.recurrence === "DAILY"
      ? "매일"
      : notification.recurrence === "WEEKLY"
        ? `매주 ${weekdayNames[notification.weekday ?? 0] ?? ""}요일`
        : `매월 ${notification.dayOfMonth}일`;
  return [`${cadence} ${time}`.trim(), notification.skipWeekend ? "주말 제외" : null]
    .filter(Boolean)
    .join(" · ");
}
