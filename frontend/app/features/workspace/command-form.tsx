import {
  createContext,
  use,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useFetcher } from "react-router";
import { NavigationGuard } from "../../components/ui/navigation-guard";
import { Alert, Button } from "../../components/ui/primitives";
import type { CommandResult } from "./model";
import { useWorkspace } from "./workspace-context";

const CommandContext = createContext<{
  busy: boolean;
  result: CommandResult | null;
  errorId?: string;
}>({ busy: false, result: null });
export function CommandSubmit({
  children = "保存する",
  variant = "primary",
}: {
  children?: ReactNode;
  variant?: "primary" | "secondary" | "danger";
}) {
  const { busy } = use(CommandContext);
  return (
    <Button type="submit" variant={variant} disabled={busy}>
      {busy ? "保存中…" : children}
    </Button>
  );
}
export function CommandFeedback() {
  const { result, errorId } = use(CommandContext);
  if (!result) return null;
  return (
    <>
      {result.error && (
        <div id={errorId}>
          <Alert tone={result.uncertain ? "warning" : "danger"}>
            {result.error}
            {result.fields &&
              Object.entries(result.fields).map(([key, messages]) => (
                <p key={key}>
                  {key.replace(/^entries\.|^entry:/, "")}：{messages.join(" ")}
                </p>
              ))}
          </Alert>
        </div>
      )}
      {result.message && <Alert tone="success">{result.message}</Alert>}
    </>
  );
}
export function CommandForm({
  intent,
  hidden = {},
  children,
  guard = false,
}: {
  intent: string;
  hidden?: Record<string, string | number>;
  children: ReactNode;
  guard?: boolean;
}) {
  const environment = useWorkspace();
  const errorId = useId();
  const fetcher = useFetcher<CommandResult>();
  const [previewResult, setPreviewResult] = useState<CommandResult | null>(
    null,
  );
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const result =
    environment.mode === "preview" ? previewResult : (fetcher.data ?? null);
  const busy = fetcher.state !== "idle";
  const unsaved = guard && (dirty || !!result?.error);
  useEffect(() => {
    if (!busy) submitting.current = false;
    if (result?.error) {
      const first = Object.keys(result.fields ?? {})[0]?.replace(
        /^entries\./,
        "entry:",
      );
      const control = first ? formRef.current?.elements.namedItem(first) : null;
      if (control instanceof HTMLElement) {
        control.setAttribute("aria-invalid", "true");
        control.setAttribute(
          "aria-describedby",
          [
            ...new Set(
              [control.getAttribute("aria-describedby"), errorId].filter(
                Boolean,
              ),
            ),
          ].join(" "),
        );
        control.focus();
      } else
        formRef.current?.querySelector<HTMLElement>("[role='alert']")?.focus();
    }
  }, [result, busy, errorId]);
  const content = (
    <CommandContext value={{ busy, result, errorId }}>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="_csrf" value={environment.csrf} />
      {Object.entries(hidden).map(([name, value]) => (
        <input type="hidden" key={name} name={name} value={value} />
      ))}
      <fieldset disabled={busy} className="command-fields">
        {children}
      </fieldset>
      <CommandFeedback />
      {guard && (
        <NavigationGuard
          unsaved={unsaved}
          busy={busy}
          submitting={submitting}
          onDiscard={() => setDirty(false)}
        />
      )}
    </CommandContext>
  );
  function previewSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    submitting.current = true;
    setDirty(false);
    const outcome = environment.execute!(form);
    setPreviewResult(outcome);
    if (outcome.error) setDirty(true);
    submitting.current = false;
  }
  function markDirty(event: FormEvent<HTMLFormElement>) {
    setDirty(true);
    if (environment.mode === "preview") setPreviewResult(null);
    if (event.target instanceof HTMLElement) {
      event.target.removeAttribute("aria-invalid");
      const references = (event.target.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .filter((id) => id && id !== errorId);
      if (references.length)
        event.target.setAttribute("aria-describedby", references.join(" "));
      else event.target.removeAttribute("aria-describedby");
    }
  }
  if (environment.mode === "preview")
    return (
      <form
        ref={formRef}
        onSubmit={previewSubmit}
        onChange={markDirty}
        className="ui-form"
      >
        {content}
      </form>
    );
  return (
    <fetcher.Form
      ref={formRef}
      method="post"
      action="/app/actions"
      onSubmit={() => {
        submitting.current = true;
        setDirty(false);
      }}
      onChange={markDirty}
      className="ui-form"
      aria-busy={busy}
    >
      {content}
    </fetcher.Form>
  );
}
