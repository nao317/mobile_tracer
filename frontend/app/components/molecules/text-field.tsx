import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { Input } from "../atoms/input";
import { Field } from "./field";
import authStyles from "../../features/auth/auth.module.css";

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
      className={
        appearance === "login" ? authStyles["login-input"] : props.className
      }
    />
  );
  if (appearance === "login")
    return (
      <div className={authStyles["login-field-group"]}>
        <label className={authStyles["login-label"]} htmlFor={id}>
          {label}
        </label>
        <div className={authStyles["login-input-frame"]}>
          {icon && (
            <span className={authStyles["login-icon-slot"]} aria-hidden="true">
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
