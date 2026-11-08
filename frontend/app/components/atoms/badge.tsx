import type { ReactNode } from "react";
import styles from "../ui/ui.module.css";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  return (
    <span className={`${styles["ui-badge"]} ${styles[`ui-badge--${tone}`] ?? ""}`}>
      {children}
    </span>
  );
}
