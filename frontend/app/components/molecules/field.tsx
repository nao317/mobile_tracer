import type { ReactNode } from "react";
import styles from "../ui/ui.module.css";

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles["ui-field"]}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className={styles["ui-hint"]}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className={styles["ui-field-error"]} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
