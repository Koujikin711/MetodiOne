import type { HTMLAttributes, ReactNode } from "react";

/** Уникальный цвет на каждый вариант — в тёмной теме не схлопывать в один красный. */
const variants = {
  crm: "bg-[#BE185D]",
  indigo: "bg-[#4F46E5]",
  purple: "bg-[#9333EA]",
  finance: "bg-[#059669]",
  tariff: "bg-[#10B981]",
  online: "bg-[#1D4ED8]",
  blue: "bg-[#2563EB]",
  analytics: "bg-[#0284C7]",
  tasks: "bg-[#0E7490]",
  chat: "bg-[#06B6D4]",
  teal: "bg-[#0D9488]",
  trainer: "bg-[#EA580C]",
  integrations: "bg-[#7C3AED]",
  platform: "bg-[#A16207]",
  logout: "bg-[#DB2777]",
  pink: "bg-[#DB2777]",
} as const;

export type NavIconVariant = keyof typeof variants;

type Props = {
  children: ReactNode;
  variant?: NavIconVariant;
  className?: string;
} & HTMLAttributes<HTMLDivElement>;

export function NavIconBadge({ children, variant = "crm", className = "", ...rest }: Props) {
  return (
    <div
      {...rest}
      data-nav-variant={variant}
      className={[
        "shell-nav-icon flex shrink-0 items-center justify-center rounded-xl text-white",
        variants[variant],
        className,
      ].join(" ")}
    >
      <span className="flex items-center justify-center [&_svg]:stroke-[1.5] [&_svg]:stroke-current [&_svg]:fill-none">
        {children}
      </span>
    </div>
  );
}
