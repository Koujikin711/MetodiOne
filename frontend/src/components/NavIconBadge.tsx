import type { HTMLAttributes, ReactNode } from "react";

/** Уникальный цвет на каждый вариант — без соседних оттенков одного семейства. */
const variants = {
  crm: "bg-[#E11D48]",
  indigo: "bg-[#6366F1]",
  purple: "bg-[#A855F7]",
  finance: "bg-[#16A34A]",
  tariff: "bg-[#14B8A6]",
  online: "bg-[#2563EB]",
  blue: "bg-[#3B82F6]",
  analytics: "bg-[#0EA5E9]",
  tasks: "bg-[#0891B2]",
  chat: "bg-[#22D3EE]",
  teal: "bg-[#2DD4BF]",
  trainer: "bg-[#F97316]",
  integrations: "bg-[#8B5CF6]",
  platform: "bg-[#EAB308]",
  logout: "bg-[#F43F5E]",
  pink: "bg-[#EC4899]",
} as const;

export type NavIconVariant = keyof typeof variants;

type Props = {
  children: ReactNode;
  variant?: NavIconVariant;
  className?: string;
} & HTMLAttributes<HTMLDivElement>;

const darkInk: Partial<Record<NavIconVariant, true>> = {
  platform: true,
  chat: true,
  teal: true,
  tariff: true,
};

export function NavIconBadge({ children, variant = "crm", className = "", ...rest }: Props) {
  return (
    <div
      {...rest}
      data-nav-variant={variant}
      className={[
        "shell-nav-icon flex shrink-0 items-center justify-center rounded-xl",
        darkInk[variant] ? "text-slate-900" : "text-white",
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
