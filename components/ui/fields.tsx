import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

import styles from "./ui.module.css";

type FieldFrameProps = {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  children: (describedBy: string | undefined) => ReactNode;
};

function FieldFrame({
  id,
  label,
  description,
  error,
  children,
}: FieldFrameProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      {children(describedBy)}
      {description ? (
        <p id={descriptionId} className={styles.supportText}>
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type TextFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "aria-describedby"
> & {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
};

export function TextField({
  id,
  label,
  description,
  error,
  className,
  ...props
}: TextFieldProps) {
  return (
    <FieldFrame id={id} label={label} description={description} error={error}>
      {(describedBy) => (
        <input
          {...props}
          id={id}
          className={[styles.input, className].filter(Boolean).join(" ")}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
        />
      )}
    </FieldFrame>
  );
}

export type TextAreaFieldProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "id" | "aria-describedby"
> & {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
};

export function TextAreaField({
  id,
  label,
  description,
  error,
  className,
  ...props
}: TextAreaFieldProps) {
  return (
    <FieldFrame id={id} label={label} description={description} error={error}>
      {(describedBy) => (
        <textarea
          {...props}
          id={id}
          className={[styles.textarea, className].filter(Boolean).join(" ")}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
        />
      )}
    </FieldFrame>
  );
}
