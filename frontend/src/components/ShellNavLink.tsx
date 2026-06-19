import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import { GradientIconBox, type NavIconVariant } from "@/components/GradientIconBox";

type Props = {
  to: string;
  end?: boolean;
  title: string;
  labelShort: string;
  labelFull: string;
  variant?: NavIconVariant;
  icon: ReactNode;
  expanded: boolean;
};

export function ShellNavLink({ to, end, title, labelShort, labelFull, variant = "crm", icon, expanded }: Props) {
  return (
    <NavLink
      to={to}
      end={end}
      title={title}
      className={({ isActive }) =>
        ["shell-nav-link", expanded ? "shell-nav-link--expanded" : "shell-nav-link--collapsed", isActive ? "is-active" : ""]
          .filter(Boolean)
          .join(" ")
      }
    >
      <GradientIconBox variant={variant} className="shell-nav-icon-box h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]">
        {icon}
      </GradientIconBox>
      <span className="shell-nav-text">{labelFull}</span>
      <span className="shell-nav-label">{labelShort}</span>
    </NavLink>
  );
}
