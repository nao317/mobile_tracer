import type { RefObject } from "react";
import { useBeforeUnload, useBlocker } from "react-router";
import { Alert, Button } from "./primitives";

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
  const hasChanges = () =>
    typeof unsaved === "function" ? unsaved() : unsaved;
  const blocker = useBlocker(
    () => hasChanges() && !busy && !submitting.current,
  );
  useBeforeUnload((event) => {
    if (hasChanges() && !busy) event.preventDefault();
  });
  if (blocker.state !== "blocked") return null;
  return (
    <Alert tone="warning">
      保存していない入力があります。移動しますか？
      <div className="ui-actions">
        <Button onClick={() => blocker.reset()}>編集を続ける</Button>
        <Button
          variant="secondary"
          onClick={() => {
            onDiscard();
            blocker.proceed();
          }}
        >
          保存せず移動する
        </Button>
      </div>
    </Alert>
  );
}
