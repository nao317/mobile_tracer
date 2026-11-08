import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { useTranslation } from "./display-settings";

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const t = useTranslation();
  return (
    <button
      type={type}
      className={className ?? `ui-button ui-button--${variant}`}
      {...props}
      children={
        typeof props.children === "string" ? t(props.children) : props.children
      }
    />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      autoComplete="off"
      name={props.name ?? props.id}
      {...props}
      className={props.className ?? "ui-input"}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      name={props.name ?? props.id}
      {...props}
      className={props.className ?? "ui-input"}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={4}
      autoComplete="off"
      name={props.name ?? props.id}
      {...props}
      className={props.className ?? "ui-input"}
    />
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  const t = useTranslation();
  return (
    <div className="ui-field">
      <label htmlFor={id}>{typeof label === "string" ? t(label) : label}</label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="ui-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="ui-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({
  label,
  icon,
  error,
  hint,
  appearance = "default",
  id: providedId,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  icon?: ReactNode;
  error?: string;
  hint?: string;
  appearance?: "default" | "login";
}) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const describedBy =
    [props["aria-describedby"], hint && `${id}-hint`, error && `${id}-error`]
      .filter(Boolean)
      .join(" ") || undefined;
  const input = (
    <Input
      {...props}
      id={id}
      name={props.name ?? id}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      className={appearance === "login" ? "login-input" : props.className}
    />
  );
  if (appearance === "login")
    return (
      <div className="login-field-group">
        <label className="login-label" htmlFor={id}>
          {label}
        </label>
        <div className="login-input-frame">
          {icon && (
            <span className="login-icon-slot" aria-hidden="true">
              {icon}
            </span>
          )}
          {input}
        </div>
        {error && (
          <p id={`${id}-error`} role="alert">
            {error}
          </p>
        )}
        {hint && <p id={`${id}-hint`}>{hint}</p>}
      </div>
    );
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      {input}
    </Field>
  );
}

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
      className={className ?? `ui-alert ui-alert--${tone}`}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>;
}

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
  const t = useTranslation();
  return (
    <section className="ui-panel" aria-labelledby={title ? titleId : undefined}>
      {(title || actions) && (
        <div className="ui-panel-heading">
          {title && <h2 id={titleId}>{t(title)}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  const t = useTranslation();
  return (
    <header className="ui-page-heading">
      <div>
        {eyebrow && <p className="ui-eyebrow">{eyebrow}</p>}
        <h1>{t(title)}</h1>
        {description && <p className="ui-muted">{t(description)}</p>}
      </div>
      {actions && <div className="ui-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const t = useTranslation();
  return (
    <div className="ui-empty">
      <h2>{t(title)}</h2>
      {children && (
        <p>{typeof children === "string" ? t(children) : children}</p>
      )}
      {actions && <div className="ui-actions">{actions}</div>}
    </div>
  );
}
