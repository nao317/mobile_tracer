import type { ReactNode } from "react";
import styles from "../ui/ui.module.css";

// Kept as a compatibility boundary while screens move their labels to navigation.
// Existing title props remain accepted but only actions produce visible content.
export function PageHeader({ actions }: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  if (!actions) return null;
  return (
    <div className={styles["ui-page-heading"]}>
      <div className={styles["ui-actions"]}>{actions}</div>
    </div>
  );
}
