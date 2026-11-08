import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { clearNativeValidation, localizeNativeValidation } from "./native-validation";
import styles from "../ui/ui.module.css";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      autoComplete="off"
      name={props.name ?? props.id}
      {...props}
      className={props.className ?? styles["ui-input"]}
      onInvalid={(event) => {
        props.onInvalid?.(event);
        if (!event.defaultPrevented) localizeNativeValidation(event.currentTarget);
      }}
      onInput={(event) => {
        clearNativeValidation(event.currentTarget);
        props.onInput?.(event);
      }}
      onChange={(event) => {
        clearNativeValidation(event.currentTarget);
        props.onChange?.(event);
      }}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      name={props.name ?? props.id}
      {...props}
      className={props.className ?? styles["ui-input"]}
      onInvalid={(event) => {
        props.onInvalid?.(event);
        if (!event.defaultPrevented) localizeNativeValidation(event.currentTarget);
      }}
      onInput={(event) => {
        clearNativeValidation(event.currentTarget);
        props.onInput?.(event);
      }}
      onChange={(event) => {
        clearNativeValidation(event.currentTarget);
        props.onChange?.(event);
      }}
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
      className={props.className ?? styles["ui-input"]}
      onInvalid={(event) => {
        props.onInvalid?.(event);
        if (!event.defaultPrevented) localizeNativeValidation(event.currentTarget);
      }}
      onInput={(event) => {
        clearNativeValidation(event.currentTarget);
        props.onInput?.(event);
      }}
      onChange={(event) => {
        clearNativeValidation(event.currentTarget);
        props.onChange?.(event);
      }}
    />
  );
}
