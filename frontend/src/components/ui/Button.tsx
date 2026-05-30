import type { ButtonHTMLAttributes, ReactNode } from "react";

import { theme } from "@/lib/theme";

type Variant = "primary" | "secondary" | "danger" | "success";

const variantClass: Record<Variant, string> = {
  primary: theme.btnPrimary,
  secondary: theme.btnSecondary,
  danger: theme.btnDanger,
  success: theme.btnSuccess,
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

export function Button({ variant = "primary", className = "", children, ...rest }: Props) {
  return (
    <button type="button" className={`${variantClass[variant]} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}
