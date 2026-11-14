import { type HTMLAttributes, type ReactNode, useId } from "react";

import styles from "./ui.module.css";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  status?: "confirmed" | "unconfirmed" | "neutral";
};

export function Badge({ status = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={[styles.badge, styles[`badge_${status}`], className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

export type AvatarProps = {
  initial: string;
  name?: string;
  shape?: "circle" | "group";
  size?: "regular" | "large";
};

export function Avatar({
  initial,
  name,
  shape = "circle",
  size = "regular",
}: AvatarProps) {
  return (
    <span
      className={[
        styles.avatar,
        styles[`avatar_${shape}`],
        styles[`avatar_${size}`],
      ].join(" ")}
      role={name ? "img" : undefined}
      aria-label={name ? `${name} 아바타` : undefined}
      aria-hidden={name ? undefined : true}
    >
      {Array.from(initial.trim())[0] ?? ""}
    </span>
  );
}

export type ProgressProps = {
  value: number;
  max: number;
  label: string;
};

export function Progress({ value, max, label }: ProgressProps) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const safeValue = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), safeMax);
  const percentage = (safeValue / safeMax) * 100;

  return (
    <div
      className={styles.progress}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max > 0 ? max : 0}
      aria-valuenow={Math.min(Math.max(value, 0), Math.max(max, 0))}
    >
      <span className={styles.progressFill} style={{ width: `${percentage}%` }} />
    </div>
  );
}

export type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  label?: string;
  lines?: number;
};

export function Skeleton({
  label = "불러오는 중",
  lines = 3,
  className,
  ...props
}: SkeletonProps) {
  const lineCount = Math.max(1, Math.min(Math.floor(lines), 8));

  return (
    <div
      className={[styles.skeleton, className].filter(Boolean).join(" ")}
      aria-busy="true"
      aria-live="polite"
      {...props}
    >
      <span className={styles.visuallyHidden}>{label}</span>
      {Array.from({ length: lineCount }, (_, index) => (
        <span className={styles.skeletonLine} aria-hidden="true" key={index} />
      ))}
    </div>
  );
}

export type NoticeProps = HTMLAttributes<HTMLDivElement> & {
  tone?: "info" | "error";
};

export function Notice({ tone = "info", className, ...props }: NoticeProps) {
  return (
    <div
      className={[styles.notice, styles[`notice_${tone}`], className]
        .filter(Boolean)
        .join(" ")}
      role={tone === "error" ? "alert" : undefined}
      {...props}
    />
  );
}

export type LiveRegionProps = {
  children: ReactNode;
  politeness?: "polite" | "assertive";
};

export function LiveRegion({ children, politeness = "polite" }: LiveRegionProps) {
  return (
    <div
      className={styles.liveRegion}
      role={politeness === "assertive" ? "alert" : "status"}
      aria-live={politeness}
      aria-atomic="true"
    >
      {children}
    </div>
  );
}

type StateKind = "empty" | "error" | "forbidden" | "unavailable";

export type StatePanelProps = {
  kind: StateKind;
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
};

export function StatePanel({ kind, title, description, action }: StatePanelProps) {
  const titleId = useId();

  return (
    <section
      className={[styles.statePanel, styles[`statePanel_${kind}`]].join(" ")}
      aria-labelledby={titleId}
      role={kind === "error" ? "alert" : kind === "forbidden" ? "status" : undefined}
    >
      <span className={styles.stateIcon} aria-hidden="true">
        {kind === "error" ? "!" : kind === "forbidden" ? "×" : "·"}
      </span>
      <h2 id={titleId} className={styles.stateTitle}>
        {title}
      </h2>
      <p className={styles.stateDescription}>{description}</p>
      {action ? <div className={styles.stateAction}>{action}</div> : null}
    </section>
  );
}
