import { Badge, Panel } from "../../components/ui/primitives";
import { Pagination } from "../../components/molecules/pagination";
import { useTranslation } from "../../components/ui/display-settings";
import type { LicensePageData } from "./catalog.server";
import uiStyles from "../../components/ui/ui.module.css";
import styles from "./licenses.module.css";

export function LicenseList({ data, pagination }: LicensePageData) {
  const t = useTranslation();
  return (
    <div className={`${uiStyles["ui-stack"]} ${styles.catalog}`}>
      <Panel title={t("licenses.title")}>
        <p>{t("licenses.description")}</p>
      </Panel>
      {data.map((item) => (
        <Panel key={item.id} title={item.name} actions={<Badge>{item.license || t("licenses.seeText")}</Badge>}>
          <div className={styles.metadata}>
            <span>{t("licenses.version", { version: item.version })}</span>
            <span>{t(item.ecosystem === "npm" ? "licenses.npm" : item.ecosystem === "go" ? "licenses.go" : item.ecosystem === "font" ? "licenses.font" : "licenses.infrastructure")}</span>
            <a className={uiStyles["ui-text-link"]} href={item.url} target="_blank" rel="noreferrer">{t("licenses.project")}</a>
            <a className={uiStyles["ui-text-link"]} href={item.licenseUrl} target="_blank" rel="noreferrer">{t("licenses.source")}</a>
          </div>
          {item.notices.length > 0 ? (
            <details className={styles.details}>
              <summary>{t("licenses.showText")}</summary>
              {item.notices.map((notice) => (
                <div key={notice.file}>
                  <h3>{notice.file}</h3>
                  <pre className={styles.text}>{notice.text}</pre>
                </div>
              ))}
            </details>
          ) : <p>{t("licenses.sourceOnly")}</p>}
        </Panel>
      ))}
      <Pagination pagination={pagination} />
    </div>
  );
}
