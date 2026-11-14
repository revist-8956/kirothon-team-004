"use client";

import {
  type AnchorHTMLAttributes,
  type ComponentPropsWithRef,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useId,
} from "react";

import styles from "./ui.module.css";

type ButtonVariant = "primary" | "secondary" | "neutral" | "danger";
type ButtonSize = "regular" | "compact";

function actionClassName(
  variant: ButtonVariant,
  size: ButtonSize,
  className?: string,
) {
  return [
    styles.button,
    styles[`button_${variant}`],
    styles[`button_${size}`],
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "regular",
    className,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={actionClassName(variant, size, className)}
      {...props}
    />
  );
});

export type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function ButtonLink({
  variant = "primary",
  size = "regular",
  className,
  ...props
}: ButtonLinkProps) {
  return (
    <a className={actionClassName(variant, size, className)} {...props} />
  );
}

export type SegmentedOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export type SegmentedControlProps = {
  legend: string;
  name: string;
  value: string;
  options: readonly SegmentedOption[];
  onChange: (value: string) => void;
  describedBy?: string;
};

export function SegmentedControl({
  legend,
  name,
  value,
  options,
  onChange,
  describedBy,
}: SegmentedControlProps) {
  return (
    <fieldset className={styles.segmentedFieldset} aria-describedby={describedBy}>
      <legend className={styles.visuallyHidden}>{legend}</legend>
      <div className={styles.segmentedControl}>
        {options.map((option) => (
          <label className={styles.segmentedOption} key={option.value}>
            <input
              className={styles.segmentedInput}
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span className={styles.segmentedLabel}>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export type ChipProps = ComponentPropsWithRef<"button"> & {
  selected: boolean;
};

export function Chip({ selected, className, type = "button", ...props }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={[styles.chip, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: ReactNode;
  description?: ReactNode;
};

function Choice({
  type,
  label,
  description,
  className,
  id: providedId,
  ...props
}: ChoiceProps & {
  type: "checkbox" | "radio";
}) {
  const generatedId = useId();
  const controlId = providedId ?? generatedId;
  const labelId = `${controlId}-label`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const describedBy = [props["aria-describedby"], descriptionId]
    .filter(Boolean)
    .join(" ") || undefined;
  const labelledBy = [props["aria-labelledby"], labelId]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <label className={[styles.choice, className].filter(Boolean).join(" ")}>
      <span className={styles.choiceText}>
        <span id={labelId} className={styles.choiceLabel}>
          {label}
        </span>
        {description ? (
          <span id={descriptionId} className={styles.supportText}>
            {description}
          </span>
        ) : null}
      </span>
      <input
        {...props}
        id={controlId}
        type={type}
        className={styles.choiceInput}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
      />
    </label>
  );
}

export function CheckboxField(props: ChoiceProps) {
  return <Choice {...props} type="checkbox" />;
}

export function RadioField(props: ChoiceProps) {
  return <Choice {...props} type="radio" />;
}

export type SwitchProps = Omit<
  ComponentPropsWithRef<"button">,
  "children" | "role" | "aria-checked" | "onChange"
> & {
  checked: boolean;
  label: ReactNode;
  description?: ReactNode;
  onCheckedChange: (checked: boolean) => void;
};

export function Switch({
  checked,
  label,
  description,
  onCheckedChange,
  id,
  ...props
}: SwitchProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-label`;
  const descriptionId = description ? `${controlId}-description` : undefined;

  return (
    <div className={styles.switchRow}>
      <span className={styles.choiceText}>
        <span id={labelId} className={styles.choiceLabel}>
          {label}
        </span>
        {description ? (
          <span id={descriptionId} className={styles.supportText}>
            {description}
          </span>
        ) : null}
      </span>
      <button
        {...props}
        id={controlId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        className={styles.switchButton}
        onClick={() => onCheckedChange(!checked)}
      >
        <span className={styles.switchTrack} aria-hidden="true">
          <span className={styles.switchThumb} />
        </span>
      </button>
    </div>
  );
}
