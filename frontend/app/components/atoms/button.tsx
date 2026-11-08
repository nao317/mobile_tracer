import type { ButtonHTMLAttributes } from "react";
import styles from "../ui/ui.module.css";

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button
      type={type}
      className={
        className ?? `${styles["ui-button"]} ${styles[`ui-button--${variant}`]}`
      }
      {...props}
    />
  );
}
