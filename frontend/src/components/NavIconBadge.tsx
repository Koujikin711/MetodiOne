import type { HTMLAttributes, ReactNode } from "react";

/** Единая indigo-шкала сайдбара (lux brand). */
const variants = {
  crm: "bg-[#4338ca]",
  tariff: "bg-[#3730a3]",
  online: "bg-[#4f46e5]",
  tasks: "bg-[#4f46e5]",
  trainer: "bg-[#6366f1]",
  finance: "bg-[#3730a3]",
  chat: "bg-[#4f46e5]",
  analytics: "bg-[#6366f1]",
  platform: "bg-[#312e81]",
  integrations: "bg-[#4f46e5]",
  logout: "bg-[#64748b]",
  indigo: "bg-[#4338ca]",
  purple: "bg-[#3730a3]",
  teal: "bg-[#4f46e5]",
  blue: "bg-[#6366f1]",
  pink: "bg-[#64748b]",
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
