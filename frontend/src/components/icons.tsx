import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function iconProps(props: IconProps) {
  const { className, ...rest } = props;
  return {
    xmlns: "http://www.w3.org/2000/svg" as const,
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: className ?? "h-4 w-4",
    ...rest,
  };
}

export function LayoutDashboard(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </svg>
  );
}

/** CRM / воронка */
export function Funnel(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M3 5h18" />
      <path d="M6 10h12" />
      <path d="M10 15h4" />
      <path d="M11 15v5h2v-5" />
    </svg>
  );
}

export function CheckSquare(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

export function BarChart3(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </svg>
  );
}

/** KPI / цель */
export function Target(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

/** Geo-трекер / геолокация */
export function MapPin(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

/** Финансы / касса */
export function Wallet(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 1 0 0 4h4v-4Z" />
    </svg>
  );
}

export function LogOut(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  );
}

export function Calendar(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
    </svg>
  );
}

export function TrendingUp(props: IconProps) {
  return (
    <svg {...iconProps({ ...props, className: props.className ?? "h-6 w-6" })}>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

export function Plus(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <line x1="12" x2="12" y1="5" y2="19" />
      <line x1="5" x2="19" y1="12" y2="12" />
    </svg>
  );
}

export function MoreHorizontal(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

export function Pencil(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function Trash2(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

export function GripVertical(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="9" cy="5" r="1" />
      <circle cx="15" cy="5" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="19" r="1" />
      <circle cx="15" cy="19" r="1" />
    </svg>
  );
}

export function Users(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M16 11a4 4 0 1 0-8 0" />
      <path d="M16 11a4 4 0 1 1-8 0" />
      <path d="M16 11c2.5 0 5 1.3 5 4v2H3v-2c0-2.7 2.5-4 5-4" />
    </svg>
  );
}

export function MessageCircle(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H7l-4 3v-5.5A8.5 8.5 0 1 1 21 11.5Z" />
    </svg>
  );
}

/** Лиды / контакты (меню «Мои лиды») */
export function UserRound(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </svg>
  );
}

/** Интеграции / подключения */
export function Plug(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  );
}

export function Sun(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

export function Moon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

export function Menu(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M4 5h16" />
      <path d="M4 12h16" />
      <path d="M4 19h16" />
    </svg>
  );
}

/** HoReCa / ресторан */
export function UtensilsCrossed(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8" />
      <path d="M15 15 3 3" />
      <path d="m9 9-6 6 2 2 2-2 2 2 4-4-2-2 2-2Z" />
      <path d="m22 22-5-5" />
    </svg>
  );
}
