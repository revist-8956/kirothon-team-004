"use client";

import { FormEvent, useMemo, useState } from "react";

import {
  getNextDispatchPreview,
  SCHEDULE_TIMEZONE,
  type Recurrence,
  type ScheduleSpec,
} from "@/domain/schedule";
import { Button, Card, CardHeader, Chip, SegmentedControl, Switch } from "@/components/ui";

import styles from "./schedule-form.module.css";

type ScheduleKind = "ONE_TIME" | "RECURRING";
type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type ScheduleSubmission = {
  readonly draftId?: string;
  readonly schedule: ScheduleSpec;
};

export type ScheduleSubmissionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly message: string;
      readonly fieldErrors?: Partial<Record<"oneTimeDate" | "startDate" | "localTime" | "weekday" | "dayOfMonth", string>>;
    };

export type ScheduleFormProps = {
  /** The server-authorized draft identifier carried from the compose step. */
  readonly draftId?: string;
  /** Task 7.7 supplies the server reservation action through this boundary. */
  readonly onSchedule?: (submission: ScheduleSubmission) => ScheduleSubmissionResult | void | Promise<ScheduleSubmissionResult | void>;
  /** Injectable clock for deterministic previews and component tests. */
  readonly now?: Date;
  readonly initialKind?: ScheduleKind;
  readonly initialRecurrence?: Recurrence;
  readonly initialStartDate?: string;
  readonly initialLocalTime?: string;
  readonly initialWeekday?: Weekday;
  readonly initialDayOfMonth?: number;
  readonly initialSkipWeekend?: boolean;
};

type FormErrors = Partial<Record<"oneTimeDate" | "startDate" | "localTime" | "weekday" | "dayOfMonth", string>>;

const weekdayLabels: ReadonlyArray<{ value: Weekday; label: string }> = [
  { value: 1, label: "월" },
  { value: 2, label: "화" },
  { value: 3, label: "수" },
  { value: 4, label: "목" },
  { value: 5, label: "금" },
  { value: 6, label: "토" },
  { value: 7, label: "일" },
];

const weekdayNames = ["", "월", "화", "수", "목", "금", "토", "일"] as const;

function kstDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHEDULE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function oneTimeInstant(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(time)) {
    return null;
  }

  const instant = new Date(`${date}T${time}:00+09:00`);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

function koreanDateTime(instant: Date): string {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHEDULE_TIMEZONE,
    month: "numeric",
    day: "numeric",
  }).formatToParts(instant);
  const values = new Map(dateParts.map((part) => [part.type, part.value]));
  const weekday = new Intl.DateTimeFormat("ko-KR", {
    timeZone: SCHEDULE_TIMEZONE,
    weekday: "short",
  }).format(instant);
  const time = new Intl.DateTimeFormat("ko-KR", {
    timeZone: SCHEDULE_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);

  return `${Number(values.get("month"))}월 ${Number(values.get("day"))}일(${weekday}) ${time}`;
}

function movedPreviewMessage(
  sourceDates: readonly string[],
  effectiveDate: string,
  recurrence: Recurrence,
): string | null {
  const movedDate = sourceDates.find((sourceDate) => sourceDate !== effectiveDate);
  if (!movedDate) return null;

  const source = new Date(`${movedDate}T00:00:00+09:00`);
  const effective = new Date(`${effectiveDate}T00:00:00+09:00`);
  const sourceWeekday = new Intl.DateTimeFormat("ko-KR", {
    timeZone: SCHEDULE_TIMEZONE,
    weekday: "short",
  }).format(source);
  const effectiveWeekday = new Intl.DateTimeFormat("ko-KR", {
    timeZone: SCHEDULE_TIMEZONE,
    weekday: "short",
  }).format(effective);

  const prefix = recurrence === "WEEKLY" ? "매주 " : "";
  return `${prefix}${sourceWeekday}요일 회차는 다음 ${effectiveWeekday}요일에 보내요.`;
}

/**
 * Renders and locally validates the second compose step. A typed callback keeps
 * the UI independent from the reservation command while carrying its draft ID.
 */
export function ScheduleForm({
  draftId,
  onSchedule,
  now = new Date(),
  initialKind = "RECURRING",
  initialRecurrence = "WEEKLY",
  initialStartDate,
  initialLocalTime = "09:00",
  initialWeekday = 6,
  initialDayOfMonth = 1,
  initialSkipWeekend = true,
}: ScheduleFormProps) {
  const today = kstDate(now);
  const [kind, setKind] = useState<ScheduleKind>(initialKind);
  const [recurrence, setRecurrence] = useState<Recurrence>(initialRecurrence);
  const [date, setDate] = useState(initialStartDate ?? today);
  const [localTime, setLocalTime] = useState(initialLocalTime);
  const [weekday, setWeekday] = useState<Weekday>(initialWeekday);
  const [dayOfMonth, setDayOfMonth] = useState(String(initialDayOfMonth));
  const [skipWeekend, setSkipWeekend] = useState(initialSkipWeekend);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const schedule = useMemo<ScheduleSpec | null>(() => {
    if (kind === "ONE_TIME") {
      const at = oneTimeInstant(date, localTime);
      return at ? { kind: "ONE_TIME", at } : null;
    }

    const base = {
      kind: "RECURRING" as const,
      recurrence,
      startDate: date,
      localTime,
      skipWeekend,
      timezone: SCHEDULE_TIMEZONE,
    };

    if (recurrence === "WEEKLY") return { ...base, weekday };
    if (recurrence === "MONTHLY") {
      const parsedDayOfMonth = Number(dayOfMonth);
      return Number.isInteger(parsedDayOfMonth) ? { ...base, dayOfMonth: parsedDayOfMonth } : null;
    }
    return base;
  }, [date, dayOfMonth, kind, localTime, recurrence, skipWeekend, weekday]);

  const preview = useMemo(() => {
    if (!schedule) return null;
    try {
      return getNextDispatchPreview(schedule, now);
    } catch {
      return null;
    }
  }, [now, schedule]);

  function validate(): FormErrors {
    const nextErrors: FormErrors = {};

    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
      nextErrors[kind === "ONE_TIME" ? "oneTimeDate" : "startDate"] = "날짜를 선택해 주세요.";
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(localTime)) {
      nextErrors.localTime = "발송 시각을 선택해 주세요.";
    }
    if (kind === "RECURRING" && recurrence === "WEEKLY" && !weekdayNames[weekday]) {
      nextErrors.weekday = "요일을 선택해 주세요.";
    }
    if (kind === "RECURRING" && recurrence === "MONTHLY") {
      const parsedDay = Number(dayOfMonth);
      if (!Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31) {
        nextErrors.dayOfMonth = "매월 날짜는 1일부터 31일 사이여야 해요.";
      }
    }
    if (kind === "ONE_TIME" && schedule?.kind === "ONE_TIME" && new Date(schedule.at).getTime() <= now.getTime()) {
      nextErrors.oneTimeDate = "과거 시각에는 예약할 수 없어요.";
    }

    return nextErrors;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    setSubmissionError(null);
    if (Object.keys(nextErrors).length > 0 || !schedule) return;

    if (!onSchedule) return;
    setIsSubmitting(true);
    try {
      const result = await onSchedule({ draftId, schedule });
      if (result?.ok === false) {
        setSubmissionError(result.message);
        setErrors(result.fieldErrors ?? {});
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const previewMessage = preview
    ? movedPreviewMessage(preview.sourceDates, preview.effectiveDate, recurrence)
    : null;

  return (
    <form className={styles.form} noValidate onSubmit={submit}>
      {draftId ? <input name="draftId" type="hidden" value={draftId} /> : null}
      {submissionError ? <p className={styles.error} role="alert">{submissionError}</p> : null}
      <Card>
        <CardHeader title="발송 유형" />
        <SegmentedControl
          legend="발송 유형"
          name="schedule-kind"
          value={kind}
          onChange={(value) => {
            setKind(value as ScheduleKind);
            setErrors({});
          }}
          options={[
            { value: "ONE_TIME", label: "일회성" },
            { value: "RECURRING", label: "반복" },
          ]}
        />
      </Card>

      {kind === "ONE_TIME" ? (
        <Card>
          <CardHeader title="발송 일시" />
          <div className={styles.dateTimeFields}>
            <label className={styles.field} htmlFor="one-time-date">
              <span>날짜</span>
              <input
                id="one-time-date"
                name="oneTimeDate"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                aria-describedby={errors.oneTimeDate ? "one-time-date-error" : undefined}
                aria-invalid={errors.oneTimeDate ? true : undefined}
              />
            </label>
            <label className={styles.field} htmlFor="one-time-time">
              <span>발송 시각</span>
              <input
                id="one-time-time"
                name="localTime"
                type="time"
                value={localTime}
                onChange={(event) => setLocalTime(event.target.value)}
                aria-describedby={errors.localTime ? "local-time-error" : undefined}
                aria-invalid={errors.localTime ? true : undefined}
              />
            </label>
          </div>
          {errors.oneTimeDate ? <p id="one-time-date-error" className={styles.error} role="alert">{errors.oneTimeDate}</p> : null}
          {errors.localTime ? <p id="local-time-error" className={styles.error} role="alert">{errors.localTime}</p> : null}
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="반복 주기" />
            <div className={styles.recurrenceChoices} role="radiogroup" aria-label="반복 주기">
              {([
                ["DAILY", "매일"],
                ["WEEKLY", "매주"],
                ["MONTHLY", "매월"],
              ] as const).map(([value, label]) => (
                <Chip
                  aria-checked={recurrence === value}
                  key={value}
                  onClick={() => {
                    setRecurrence(value);
                    setErrors({});
                  }}
                  role="radio"
                  selected={recurrence === value}
                >
                  {label}
                </Chip>
              ))}
            </div>

            <label className={styles.field} htmlFor="recurring-start-date">
              <span>반복 시작일</span>
              <input
                id="recurring-start-date"
                name="startDate"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                aria-describedby={errors.startDate ? "start-date-error" : undefined}
                aria-invalid={errors.startDate ? true : undefined}
              />
            </label>

            {recurrence === "WEEKLY" ? (
              <fieldset className={styles.weekdays} aria-describedby={errors.weekday ? "weekday-error" : undefined}>
                <legend>요일</legend>
                <div className={styles.weekdayGrid}>
                  {weekdayLabels.map((option) => (
                    <Chip
                      aria-label={`${option.label}요일`}
                      key={option.value}
                      onClick={() => setWeekday(option.value)}
                      selected={weekday === option.value}
                    >
                      {option.label}
                    </Chip>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {recurrence === "MONTHLY" ? (
              <label className={styles.field} htmlFor="monthly-day">
                <span>매월 날짜</span>
                <input
                  id="monthly-day"
                  name="dayOfMonth"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="31"
                  value={dayOfMonth}
                  onChange={(event) => setDayOfMonth(event.target.value)}
                  aria-describedby={errors.dayOfMonth ? "monthly-day-error" : undefined}
                  aria-invalid={errors.dayOfMonth ? true : undefined}
                />
              </label>
            ) : null}

            <label className={styles.field} htmlFor="recurring-time">
              <span>발송 시각</span>
              <input
                id="recurring-time"
                name="localTime"
                type="time"
                value={localTime}
                onChange={(event) => setLocalTime(event.target.value)}
                aria-describedby={errors.localTime ? "local-time-error" : undefined}
                aria-invalid={errors.localTime ? true : undefined}
              />
            </label>
            {errors.startDate ? <p id="start-date-error" className={styles.error} role="alert">{errors.startDate}</p> : null}
            {errors.weekday ? <p id="weekday-error" className={styles.error} role="alert">{errors.weekday}</p> : null}
            {errors.dayOfMonth ? <p id="monthly-day-error" className={styles.error} role="alert">{errors.dayOfMonth}</p> : null}
            {errors.localTime ? <p id="local-time-error" className={styles.error} role="alert">{errors.localTime}</p> : null}
          </Card>

          <Card>
            <Switch
              checked={skipWeekend}
              description="토·일 회차는 다음 평일에 보내요."
              id="skip-weekend"
              label="주말 제외"
              onCheckedChange={setSkipWeekend}
            />
            {preview ? (
              <p className={styles.preview} aria-live="polite">
                {previewMessage ? <span>{previewMessage}<br /></span> : null}
                <strong>다음 발송 {koreanDateTime(preview.dueAtUtc)}</strong>
              </p>
            ) : (
              <p className={styles.preview} aria-live="polite">다음 발송을 계산하려면 일정 정보를 입력해 주세요.</p>
            )}
          </Card>
        </>
      )}

      {kind === "ONE_TIME" ? (
        <Card>
          {preview ? (
            <p className={styles.preview} aria-live="polite"><strong>다음 발송 {koreanDateTime(preview.dueAtUtc)}</strong></p>
          ) : (
            <p className={styles.preview} aria-live="polite">과거 시각에는 예약할 수 없어요.</p>
          )}
        </Card>
      ) : null}

      <div className={styles.submitRow}>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "예약하는 중..." : "발송 예약하기"}
        </Button>
      </div>
    </form>
  );
}
