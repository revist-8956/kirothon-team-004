import type { NotificationStatusView } from "@/application/notification-status";
import { formatCalendarDate, formatShortDateTime } from "@/components/inbox";
import { appRoutes, notificationStatusRoute } from "@/components/navigation";
import { Avatar, Badge, ButtonLink, Card, Notice, PageHeader, Progress, StatePanel } from "@/components/ui";
import styles from "./status.module.css";

type VisibleStatus = Extract<NotificationStatusView, { kind: "VISIBLE" }>;

const recurrenceLabels = { DAILY: "매일", WEEKLY: "매주", MONTHLY: "매월" } as const;

/** Shown to anyone without access; the sentence and responses are never rendered. */
export function StatusAccessDenied() {
  return (
    <StatePanel
      kind="forbidden"
      title="조회 권한 없음"
      description="이 알림의 응답 현황을 볼 권한이 없어요. 그룹 알림은 현재 구성원만 볼 수 있어요."
      action={<ButtonLink href={appRoutes.inbox}>받은 알림으로 이동</ButtonLink>}
    />
  );
}

function roundHref(notificationId: string, dispatchId: string): string {
  return `${notificationStatusRoute(notificationId)}?dispatchId=${encodeURIComponent(dispatchId)}`;
}

/** `Status.html`: round selector, the selected round's tally and each recipient's response. */
export function NotificationStatusContent({ status }: { readonly status: VisibleStatus }) {
  const { notification, rounds, selected, selection } = status;
  const eyebrow = [
    "응답 현황",
    notification.mode === "GROUP" ? (notification.groupName ?? "그룹") : "개인",
    notification.senderNickname,
    notification.scheduleKind === "RECURRING" && notification.recurrence
      ? recurrenceLabels[notification.recurrence]
      : "일회성",
  ].join(" · ");
  const ownRowsOnly = notification.mode === "PERSONAL" && !notification.viewerIsSender;
  const hasUnavailableRounds = rounds.some((round) => !round.viewable);

  return (
    <div className={styles.content}>
      <PageHeader eyebrow={eyebrow} title={notification.sentence} />

      {rounds.length > 0 ? (
        <Card className={styles.section}>
          <h2 className={styles.sectionTitle}>발송 회차</h2>
          <ul className={styles.rounds} aria-label="발송 회차">
            {rounds.map((round) => {
              const label = `${round.sequence}회차 ${formatCalendarDate(round.effectiveDate)}`;
              return (
                <li key={round.dispatchId}>
                  {round.viewable ? (
                    <a
                      className={styles.round}
                      href={roundHref(notification.id, round.dispatchId)}
                      aria-current={selected?.dispatchId === round.dispatchId ? "true" : undefined}
                    >
                      <span>{label}</span>
                      <span className={styles.roundDetail}>
                        확인 {round.confirmedCount ?? 0}/{round.recipientCount ?? 0}
                      </span>
                    </a>
                  ) : (
                    <span className={`${styles.round} ${styles.round_unavailable}`} aria-disabled="true">
                      <span>{label}</span>
                      <span className={styles.roundDetail}>조회 불가</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {hasUnavailableRounds ? <p className={styles.hint}>가입 전에 발송된 회차는 볼 수 없어요.</p> : null}
        </Card>
      ) : null}

      {selection === "NO_ROUNDS" ? (
        <StatePanel
          kind="empty"
          title="아직 발송된 회차가 없어요"
          description="첫 회차가 발송되면 누가 확인했는지 여기에 보여요."
        />
      ) : null}

      {selection === "UNAVAILABLE" ? (
        <StatePanel
          kind="unavailable"
          title="조회 불가"
          description="가입 전에 발송된 회차는 수신자와 응답을 볼 수 없어요. 조회 가능한 회차를 선택해 주세요."
        />
      ) : null}

      {selected ? (
        <Card className={styles.section}>
          <div className={styles.summaryRow}>
            <h2 className={styles.sectionTitle}>
              {selected.recipientCount}명 중{" "}
              <span className={styles.summaryCount}>{selected.confirmedCount}명</span>이 확인했어요
            </h2>
            <span className={styles.summaryMeta}>
              {selected.sequence}회차 · {formatCalendarDate(selected.effectiveDate, true)}
            </span>
          </div>
          <Progress
            value={selected.confirmedCount}
            max={selected.recipientCount}
            label={`수신자 ${selected.recipientCount}명 중 ${selected.confirmedCount}명 확인`}
          />
          <ul className={styles.recipients} aria-label="수신자별 응답">
            {selected.recipients.map((recipient) => (
              <li className={styles.recipient} key={recipient.recipientId}>
                <span className={styles.recipientIdentity}>
                  <Avatar initial={recipient.nickname.slice(0, 1)} />
                  <span className={styles.recipientText}>
                    <span className={styles.recipientName}>
                      {recipient.nickname}
                      {recipient.isViewer ? " (나)" : ""}
                    </span>
                    {recipient.confirmedAt ? (
                      <span className={styles.recipientTime}>{formatShortDateTime(recipient.confirmedAt)}</span>
                    ) : null}
                  </span>
                </span>
                <Badge status={recipient.confirmedAt ? "confirmed" : "unconfirmed"}>
                  {recipient.confirmedAt ? "확인" : "미확인"}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Notice>
        {ownRowsOnly
          ? "개인 알림은 내 확인 여부만 볼 수 있어요."
          : "개인 발송은 발신자에게 모든 수신자가, 수신자에게는 본인만 보여요. 그룹을 탈퇴하면 이 화면은 ‘조회 권한 없음’으로 바뀌어요."}
      </Notice>
    </div>
  );
}
