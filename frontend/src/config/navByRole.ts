/** Группы навигации по зонам продукта (для документации и будущего рефакторинга сайдбара). */
export const NAV_ZONES = {
  home: { label: "Главная", paths: ["/app", "/desk"] },
  sales: {
    label: "Продажи",
    paths: ["/crm", "/my-leads", "/chat", "/kpi", "/analytics"],
  },
  service: { label: "Сервис", paths: ["/booking", "/reports"] },
  operations: { label: "Операции", paths: ["/finance", "/horeca"] },
  team: { label: "Команда", paths: ["/employees", "/tasks", "/attendance"] },
  settings: { label: "Настройки", paths: ["/integrations", "/billing", "/audit", "/onboarding"] },
} as const;

export const FINANCE_SUBROUTES = [
  { path: "/finance", tab: "overview" as const, label: "Обзор" },
  { path: "/finance/accounting", tab: "accounting" as const, label: "Учёт" },
  { path: "/finance/inventory", tab: "inventory" as const, label: "Склад" },
  { path: "/finance/reports", tab: "reports" as const, label: "Отчёты" },
];

export function financeTabFromPath(pathname: string): "overview" | "accounting" | "inventory" | "reports" {
  if (pathname.startsWith("/finance/accounting")) return "accounting";
  if (pathname.startsWith("/finance/inventory")) return "inventory";
  if (pathname.startsWith("/finance/reports")) return "reports";
  return "overview";
}
