import type { HTMLAttributes, ReactNode } from "react";

/** Уникальный цвет на каждый вариант — в тёмной теме не схлопывать в один красный. */
const variants = {
  crm: "bg-[#4A1521]",
  indigo: "bg-[#3730A3]",
  purple: "bg-[#6D28D9]",
  finance: "bg-[#0F4C3A]",
  tariff: "bg-[#047857]",
  online: "bg-[#1E3A8A]",
  blue: "bg-[#2563EB]",
  analytics: "bg-[#1D4ED8]",
  tasks: "bg-[#0E7490]",
  chat: "bg-[#0891B2]",
  teal: "bg-[#0F766E]",
  trainer: "bg-[#B45309]",
  integrations: "bg-[#7C3AED]",
  platform: "bg-[#78716C]",
  logout: "bg-[#5C4A42]",
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
