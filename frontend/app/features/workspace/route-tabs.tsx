import { Link } from "react-router";
import styles from "./workspace.module.css";

export function RouteTabs({
  label,
  items,
  activeTo,
}: {
  label: string;
  items: { to: string; label: string }[];
  activeTo: string;
}) {
  return (
    <nav className={styles["workspace-tabs"]} aria-label={label}>
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          aria-current={item.to === activeTo ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
