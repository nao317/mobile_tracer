import { useId, type ReactNode } from "react";
import styles from "../ui/ui.module.css";

export function Panel({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      className={styles["ui-panel"]}
      aria-labelledby={title ? titleId : undefined}
    >
      {(title || actions) && (
        <div className={styles["ui-panel-heading"]}>
          {title && <h2 id={titleId}>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
