import type { ReactNode } from "react";
import styles from "../ui/ui.module.css";

export function EmptyState({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={styles["ui-empty"]}>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className={styles["ui-actions"]}>{actions}</div>}
    </div>
  );
}
