import type { ReactNode } from "react";
import styles from "../ui/ui.module.css";

export function Alert({
  children,
  tone = "info",
  className,
}: {
  children: ReactNode;
  tone?: "info" | "success" | "warning" | "danger";
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      tabIndex={-1}
      aria-live={tone === "danger" ? "assertive" : "polite"}
      className={
        className ?? `${styles["ui-alert"]} ${styles[`ui-alert--${tone}`] ?? ""}`
      }
    >
      {children}
    </div>
  );
}
