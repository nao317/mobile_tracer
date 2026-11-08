import { Link } from "react-router";
import { useTranslation } from "../../components/ui/display-settings";

export function RouteTabs({
  label,
  items,
  activeTo,
}: {
  label: string;
  items: { to: string; label: string }[];
  activeTo: string;
}) {
  const t = useTranslation();
  return (
    <nav className="workspace-tabs" aria-label={t(label)}>
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          aria-current={item.to === activeTo ? "page" : undefined}
        >
          {t(item.label)}
        </Link>
      ))}
    </nav>
  );
}
