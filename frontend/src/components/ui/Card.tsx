import type { ReactNode } from "react";

import { theme } from "@/lib/theme";

type Props = {
  children: ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
};

export function Card({ children, className = "", title, subtitle }: Props) {
  return (
    <section className={`${theme.surfaceCard} p-4 ${className}`.trim()}>
      {title ? <h2 className="lux-subheading">{title}</h2> : null}
      {subtitle ? <p className="lux-body mt-1">{subtitle}</p> : null}
      {(title || subtitle) && children ? <div className="mt-3">{children}</div> : children}
    </section>
  );
}
