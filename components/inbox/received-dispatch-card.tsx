"use client";

import { useState, useTransition } from "react";

import type { ConfirmDispatchResult } from "@/app/actions/inbox";
import { Badge, Button, ButtonLink, Card } from "@/components/ui";
import { formatConfirmedAt } from "./format";
import styles from "./inbox.module.css";

export interface ReceivedDispatchCardData {
  readonly dispatchId: string;
  readonly sentence: string;
  readonly mode: "PERSONAL" | "GROUP";
  /** Pre-formatted "target · sender · round · sent time" line. */
  readonly meta: string;
  /** ISO instant of the viewer's first confirmation, or null. */
  readonly confirmedAt: string | null;
  /** Response status route; only group recipients get one (Requirement 12.8, 12.9). */
  readonly statusHref?: string;
}

interface ReceivedDispatchCardProps {
  readonly card: ReceivedDispatchCardData;
  readonly confirmAction: (dispatchId: string) => Promise<ConfirmDispatchResult>;
}

/**
 * One dispatch round. Rendering the card never confirms anything; only the
 * "확인" button calls the action (Requirement 13.1).
 */
export function ReceivedDispatchCard({ card, confirmAction }: ReceivedDispatchCardProps) {
  const [confirmedAt, setConfirmedAt] = useState(card.confirmedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirmed = confirmedAt !== null;

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmAction(card.dispatchId);
      if (result.ok) {
        setConfirmedAt(result.data.confirmedAt);
      } else {
        setError(result.message);
      }
    });
  }

  const confirmControl = confirmed ? (
    <Button variant="neutral" className={styles.confirmedButton} disabled>
      {formatConfirmedAt(new Date(confirmedAt))}
    </Button>
  ) : (
    <Button onClick={confirm} disabled={pending}>
      {pending ? "확인하는 중..." : "확인"}
    </Button>
  );

  return (
    <Card as="article" className={styles.card} aria-label={card.sentence}>
      <div className={styles.titleRow}>
        <h2 className={[styles.sentence, confirmed ? styles.sentence_confirmed : ""].join(" ")}>
          {card.sentence}
        </h2>
        <Badge className={styles.badge} status={confirmed ? "confirmed" : "unconfirmed"}>
          {confirmed ? "확인" : "미확인"}
        </Badge>
      </div>
      <span className={styles.meta}>{card.meta}</span>
      {card.mode === "GROUP" && card.statusHref ? (
        <div className={styles.actions}>
          {confirmControl}
          <ButtonLink variant="secondary" href={card.statusHref}>
            응답 현황
          </ButtonLink>
        </div>
      ) : (
        confirmControl
      )}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {card.mode === "PERSONAL" ? (
        <span className={styles.note}>개인 알림은 내 확인 여부만 볼 수 있어요.</span>
      ) : null}
    </Card>
  );
}
