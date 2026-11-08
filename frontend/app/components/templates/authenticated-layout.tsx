import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { Form, Link, NavLink, useLocation, useNavigation } from "react-router";
import { DisplayControls, useTranslation } from "../ui/display-settings";
import type { SessionView } from "../../lib/auth.server";
import styles from "./authenticated-layout.module.css";
import { clearNativeValidation, localizeNativeValidation } from "../atoms/native-validation";
import { activityKey, recordActivity } from "./activity-history";

export type NavigationGroup = { id: string; label: string; items: { id: string; label: string; to: string }[] };
export function AuthenticatedLayout({ children, groups, session, title }: { children: ReactNode; groups: NavigationGroup[]; session?: SessionView | null; title?: string }) {
  const t = useTranslation();
  const location = useLocation();
  const pending = useNavigation().state !== "idle";
  const [expanded, setExpanded] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  const previousLocation = useRef(location.key);
  const restoreToggle = useRef(true);
  const active = groups.flatMap(group => group.items.map(item => ({ group: group.id, path: item.to.split("?")[0] })))
    .filter(item => item.path === location.pathname || (item.path !== "/app" && item.path !== "/preview" && location.pathname.startsWith(item.path + "/")))
    .sort((a, b) => b.path.length - a.path.length)[0]?.group;
  const [openGroup, setOpenGroup] = useState<{ active?: string; id?: string }>({});
  const selectedGroup = openGroup.active === active ? openGroup.id ?? active : active;
  function close() { dialog.current?.close(); }
  function isCurrent(to: string) {
    const [path, query] = to.split("?");
    if (path !== location.pathname) return false;
    const current = new URLSearchParams(location.search);
    if (query) return [...new URLSearchParams(query)].every(([key, value]) => current.get(key) === value);
    return !groups.some(group => group.items.some(item => {
      const [otherPath, otherQuery] = item.to.split("?");
      return otherPath === path && !!otherQuery && [...new URLSearchParams(otherQuery)].every(([key, value]) => current.get(key) === value);
    }));
  }
  useEffect(() => {
    if (previousLocation.current !== location.key) {
      previousLocation.current = location.key;
      restoreToggle.current = false;
      dialog.current?.close();
      main.current?.focus();
    }
  }, [location.key]);
  useEffect(() => {
    if (title) document.title = `${title} | Mobile Tracer`;
  }, [title]);
  useEffect(() => {
    if (title && !["/app", "/app/", "/preview", "/preview/"].includes(location.pathname)) {
      recordActivity(activityKey(session?.user.email, location.pathname.startsWith("/preview")), location.pathname + location.search, title);
    }
  }, [location.pathname, location.search, title, session?.user.email]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const resize = () => { if (media.matches) dialog.current?.close(); };
    media.addEventListener("change", resize);
    return () => { media.removeEventListener("change", resize); document.body.style.overflow = ""; };
  }, []);
  function navigation(prefix: string) {
    return <nav aria-label={t("navigation.main")} className={styles.navigation}>
      {groups.map(group => <div key={group.id} className={styles.group}>
        <button type="button" className={styles.groupButton} aria-expanded={selectedGroup === group.id} aria-controls={`${prefix}-${group.id}`} onClick={() => setOpenGroup({ active, id: selectedGroup === group.id ? "" : group.id })}>
          {group.label}<ChevronDown size={16} aria-hidden="true" />
        </button>
        <div className={styles.links} id={`${prefix}-${group.id}`} hidden={selectedGroup !== group.id}>
          {group.items.map(item => <Link className={styles.link} key={item.id} to={item.to} aria-current={isCurrent(item.to) ? "page" : undefined}>{item.label}</Link>)}
        </div>
      </div>)}
    </nav>;
  }
  function account() { return session && <div className={styles.account}>
    <span>{session.user.email}</span>
    {!groups.some(group => group.items.some(item => item.to === "/account")) && <NavLink className={styles.link} to="/account">{t("navigation.account")}</NavLink>}
    <Form method="post" action="/account">
      <input type="hidden" name="intent" value="logout" />
      <input type="hidden" name="_csrf" value={session.csrf_token} />
      <button className={styles.logout} disabled={pending} type="submit">{t("navigation.logout")}</button>
    </Form>
  </div>; }
  return <div className={`${styles.layout} ${expanded ? "" : styles.collapsed}`}>
    <a className={styles.skip} href="#workspace-main">{t("navigation.skip")}</a>
    <aside hidden={!expanded} className={`${styles.sidebar} ${styles.desktop}`} id="desktop-navigation">{navigation("desktop")}{account()}</aside>
    <div className={styles.body}>
      <div className={styles.toolbar}>
        <button type="button" className={`${styles.iconButton} ${styles.desktopToggle}`} aria-label={t(expanded ? "navigation.closeMenu" : "navigation.openMenu")} aria-expanded={expanded} aria-controls="desktop-navigation" onClick={() => setExpanded(value => !value)}><Menu size={22} aria-hidden="true" /></button>
        <button type="button" ref={toggle} className={`${styles.iconButton} ${styles.mobileToggle}`} aria-label={t("navigation.openMenu")} aria-expanded={drawerOpen} aria-controls="mobile-navigation" onClick={() => { restoreToggle.current = true; dialog.current?.showModal(); setDrawerOpen(true); document.body.style.overflow = "hidden"; }}><Menu size={22} aria-hidden="true" /></button>
        <DisplayControls />
      </div>
      <div role="status" aria-live="polite" className={styles.status}>{pending ? t("navigation.loading") : ""}</div>
      <main ref={main} id="workspace-main" className={styles.main} tabIndex={-1} aria-busy={pending}
        onInvalidCapture={event => {
          const target = event.target;
          if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) localizeNativeValidation(target);
        }}
        onInputCapture={event => {
          const target = event.target;
          if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) clearNativeValidation(target);
        }}
      >{title && <h1 className={styles.status}>{title}</h1>}{children}</main>
    </div>
    <dialog ref={dialog} id="mobile-navigation" className={styles.dialog} aria-label={t("navigation.main")} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter(element => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }} onClose={() => { setDrawerOpen(false); document.body.style.overflow = ""; if (restoreToggle.current) toggle.current?.focus(); else main.current?.focus(); }} onClick={event => { if (event.target === event.currentTarget && event.clientX >= event.currentTarget.getBoundingClientRect().right) close(); }}>
      <div className={styles.drawerClose}><button type="button" className={styles.iconButton} aria-label={t("navigation.closeMenu")} onClick={close}><X size={22} aria-hidden="true" /></button></div>
      <div className={styles.sidebar}>{navigation("mobile")}{account()}</div>
    </dialog>
  </div>;
}
