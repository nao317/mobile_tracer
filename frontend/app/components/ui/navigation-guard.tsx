import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useBeforeUnload, useBlocker } from "react-router";
import { Alert, Button } from "./primitives";
import { useTranslation } from "./display-settings";
import styles from "./ui.module.css";

// Register once per screen, even when the page contains several forms.
export function NavigationGuard({
  unsaved,
  busy,
  submitting,
  onDiscard,
}: {
  unsaved: boolean | (() => boolean);
  busy: boolean;
  submitting: RefObject<boolean>;
  onDiscard: () => void;
}) {
  const t = useTranslation();
  const hasChanges = () =>
    typeof unsaved === "function" ? unsaved() : unsaved;
  const blocker = useBlocker(
    () => hasChanges() && !busy && !submitting.current,
  );
  const confirmationElement = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (blocker.state === "blocked") confirmationElement.current?.querySelector("button")?.focus();
  }, [blocker.state]);
  useBeforeUnload((event) => {
    if (hasChanges() && !busy) event.preventDefault();
  });
  if (blocker.state !== "blocked") return null;
  const confirmation = (
    <div ref={confirmationElement}><Alert tone="warning">
      {t("guard.unsaved")}
      <div className={styles["ui-actions"]}>
        <Button onClick={() => blocker.reset()}>{t("guard.continue")}</Button>
        <Button
          variant="secondary"
          onClick={() => {
            onDiscard();
            blocker.proceed();
          }}
        >
          {t("guard.discard")}
        </Button>
      </div>
    </Alert></div>
  );
  const drawer = typeof document === "undefined" ? null : document.querySelector<HTMLDialogElement>("#mobile-navigation[open]");
  return drawer ? createPortal(confirmation, drawer) : confirmation;
}
