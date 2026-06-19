import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import {
  BarChart3,
  Calendar,
  CheckSquare,
  ClipboardList,
  Funnel,
  IdCard,
  LayoutDashboard,
  MessageCircle,
  Plug,
  Target,
  UserRound,
  Users,
  Wallet,
} from "@/components/icons";
import { GradientIconBox, type NavIconVariant } from "@/components/GradientIconBox";
import type { ShellSidebarIconKey } from "@/lib/shellSidebarNavItems";

type DragHandleProps = {
  attributes: DraggableAttributes;
  listeners?: SyntheticListenerMap;
};

type Props = {
  to: string;
  end?: boolean;
  title: string;
  labelShort: string;
  labelFull: string;
  variant?: NavIconVariant;
  iconKey: ShellSidebarIconKey;
  expanded: boolean;
  dragHandleProps?: DragHandleProps;
};

const ICON_CLASS = "shell-nav-icon-glyph";

function renderIcon(iconKey: ShellSidebarIconKey): ReactNode {
  switch (iconKey) {
    case "bar-chart":
      return <BarChart3 className={ICON_CLASS} />;
    case "calendar":
      return <Calendar className={ICON_CLASS} />;
    case "check-square":
      return <CheckSquare className={ICON_CLASS} />;
    case "clipboard-list":
      return <ClipboardList className={ICON_CLASS} />;
    case "funnel":
      return <Funnel className={ICON_CLASS} />;
    case "id-card":
      return <IdCard className={ICON_CLASS} />;
    case "layout-dashboard":
      return <LayoutDashboard className={ICON_CLASS} />;
    case "message-circle":
      return <MessageCircle className={ICON_CLASS} />;
    case "plug":
      return <Plug className={ICON_CLASS} />;
    case "target":
      return <Target className={ICON_CLASS} />;
    case "user-round":
      return <UserRound className={ICON_CLASS} />;
    case "users":
      return <Users className={ICON_CLASS} />;
    case "wallet":
      return <Wallet className={ICON_CLASS} />;
    default:
      return null;
  }
}

export function ShellNavLink({
  to,
  end,
  title,
  labelShort,
  labelFull,
  variant = "crm",
  iconKey,
  expanded,
  dragHandleProps,
}: Props) {
  const collapsedDragProps = !expanded && dragHandleProps ? { ...dragHandleProps.attributes, ...dragHandleProps.listeners } : {};

  return (
    <NavLink
      to={to}
      end={end}
      title={expanded ? title : `${title} — удерживайте для перемещения`}
      className={({ isActive }) => ["shell-nav-link group", isActive ? "is-active" : ""].filter(Boolean).join(" ")}
    >
      <GradientIconBox variant={variant} className="shell-nav-icon-box" {...collapsedDragProps}>
        {renderIcon(iconKey)}
      </GradientIconBox>
      <span className="shell-nav-text">{labelFull}</span>
      <span className="shell-nav-label">{labelShort}</span>
    </NavLink>
  );
}
