import type { ReactNode } from "react";

type Props = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ title, description, actions, className = "" }: Props) {
  return (
    <header
      className={[
        "flex flex-wrap items-start justify-between gap-3",
        className || "mb-6",
      ].join(" ")}
    >
      <div className="min-w-0">
        <h1 className="lux-heading-page">{title}</h1>
        {description ? <div className="lux-body mt-1.5 max-w-2xl">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
