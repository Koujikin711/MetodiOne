import type { HTMLAttributes, ReactNode } from "react";

/** Корпоративные цвета микро-бейджей сайдбара (ivory & gold). */
const variants = {
  crm: "bg-[#4A1521]",
  tariff: "bg-[#0F4C3A]",
  online: "bg-[#1E3A8A]",
  tasks: "bg-[#2A6F85]",
  trainer: "bg-[#8C6D31]",
  finance: "bg-[#0F4C3A]",
  chat: "bg-[#2A6F85]",
  analytics: "bg-[#1E3A8A]",
  platform: "bg-[#3D3428]",
  integrations: "bg-[#4A3550]",
  logout: "bg-[#5C4A42]",
  /** Обратная совместимость со старыми именами */
  indigo: "bg-[#4A1521]",
  purple: "bg-[#0F4C3A]",
  teal: "bg-[#2A6F85]",
  blue: "bg-[#1E3A8A]",
  pink: "bg-[#5C4A42]",
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
        "shell-nav-icon flex shrink-0 items-center justify-center rounded-lg text-[var(--mo-text)]",
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

