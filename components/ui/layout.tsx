import type { HTMLAttributes, ReactNode } from "react";

import styles from "./ui.module.css";

export type PageHeaderProps = {
  title: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
};

export function PageHeader({ title, eyebrow, action }: PageHeaderProps) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeaderText}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1 className={styles.pageTitle}>{title}</h1>
      </div>
      {action ? <div className={styles.headerAction}>{action}</div> : null}
    </header>
  );
}

export type NavigationHeaderProps = {
  title: ReactNode;
  href: string;
  navigationLabel: string;
  kind?: "back" | "close";
  step?: ReactNode;
};

export function NavigationHeader({
  title,
  href,
  navigationLabel,
  kind = "back",
  step,
}: NavigationHeaderProps) {
  return (
    <header className={styles.navigationHeader}>
      <div className={styles.navigationHeaderStart}>
        <a className={styles.iconButton} href={href} aria-label={navigationLabel}>
          {kind === "close" ? <CloseIcon /> : <BackIcon />}
        </a>
        <h1 className={styles.navigationTitle}>{title}</h1>
      </div>
      {step ? <span className={styles.step}>{step}</span> : null}
    </header>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 20 20" fill="none">
      <path d="m13 4-6 6 6 6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 20 20" fill="none">
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  );
}

export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: "section" | "article" | "div";
};

export function Card({ as: Element = "section", className, ...props }: CardProps) {
  return (
    <Element
      className={[styles.card, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export type CardHeaderProps = {
  title: ReactNode;
  meta?: ReactNode;
  description?: ReactNode;
};

export function CardHeader({ title, meta, description }: CardHeaderProps) {
  return (
    <div className={styles.cardHeader}>
      <div className={styles.cardTitleRow}>
        <h2 className={styles.cardTitle}>{title}</h2>
        {meta ? <span className={styles.cardMeta}>{meta}</span> : null}
      </div>
      {description ? <p className={styles.supportText}>{description}</p> : null}
    </div>
  );
}
