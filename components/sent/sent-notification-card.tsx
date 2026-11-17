"use client";

import { useState, useTransition } from "react";

import type { StopRecurringResult } from "@/app/actions/sent";
import { Badge, Button, ButtonLink, Card, Dialog } from "@/components/ui";
import styles from "./sent.module.css";

export interface SentNotificationCardData {
  readonly notificationId: string;
  readonly sentence: string;
  /** "개인" or the group name. */
  readonly targetLabel: string;
  readonly scheduleSummary: string;
  /** "3회차 · 확인 2/3", or null before the first round is sent. */
  readonly latestRoundSummary: string | null;
  readonly statusHref: string;
  /** Only active recurring notifications can be stopped. */
  readonly canStop: boolean;
  readonly stopped: boolean;
}

interface SentNotificationCardProps {
  readonly card: SentNotificationCardData;
  readonly stopAction: (notificationId: string) => Promise<StopRecurringResult>;
}

/** One card per sent notification. The card has no nested interactive elements. */
export function SentNotificationCard({ card, stopAction }: SentNotificationCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [stopped, setStopped] = useState(card.stopped);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function stop() {
    setError(null);
    startTransition(async () => {
      const result = await stopAction(card.notificationId);
      setDialogOpen(false);
      if (result.ok) {
        setStopped(true);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <Card as="article" className={styles.card} aria-label={card.sentence}>
      <div className={styles.titleRow}>
        <h2 className={styles.sentence}>{card.sentence}</h2>
        <Badge className={styles.badge}>{card.targetLabel}</Badge>
      </div>
      <span className={styles.meta}>
        {card.scheduleSummary}
        {stopped ? " · 중지됨" : ""}
      </span>
      <span className={styles.progress}>{card.latestRoundSummary ?? "아직 발송된 회차가 없어요"}</span>
      <div className={styles.actions}>
        <ButtonLink variant="secondary" href={card.statusHref}>
          응답 현황
        </ButtonLink>
        {card.canStop && !stopped ? (
          <Button variant="neutral" onClick={() => setDialogOpen(true)} disabled={pending}>
            반복 중지
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <Dialog
        open={dialogOpen}
        title="반복 알림을 중지할까요?"
        description="앞으로의 회차는 보내지 않아요. 이미 보낸 회차와 응답 기록은 그대로 남아요."
        confirmLabel={pending ? "중지하는 중..." : "중지"}
        cancelLabel="취소"
        destructive
        onConfirm={stop}
        onClose={() => setDialogOpen(false)}
      />
    </Card>
  );
}
