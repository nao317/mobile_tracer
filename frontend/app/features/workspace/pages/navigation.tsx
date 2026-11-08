import { Link, useLocation, useSearchParams, type LinkProps } from "react-router";
import { detailURL, returnURL } from "../../../lib/return-url";
import { useTranslation } from "../../../components/ui/display-settings";
import uiStyles from "../../../components/ui/ui.module.css";

/** Carry the originating list's filters and page through detail and edit links. */
export function CoreLink({ to, back = false, fromHere = false, ...props }: LinkProps & { back?: boolean; fromHere?: boolean; }) {
  const location = useLocation();
  const [search] = useSearchParams();
  if (typeof to !== "string") return <Link {...props} to={to} />;
  const listURL = fromHere ? `${location.pathname}${location.search}` : returnURL(search.get("returnTo"), `${location.pathname}${location.search}`);
  return <Link {...props} to={back ? returnURL(search.get("returnTo"), to) : detailURL(to, listURL)} />;
}

export function CoreBackLink({ to }: { to: string; }) {
  const t = useTranslation();
  return <CoreLink back to={to} className={uiStyles["ui-text-link"]}>{t("common.back")}</CoreLink>;
}
