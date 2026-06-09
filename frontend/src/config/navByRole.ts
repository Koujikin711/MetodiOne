/** Группы навигации по зонам продукта (для документации и будущего рефакторинга сайдбара). */
export const NAV_ZONES = {
  home: { label: "Главная", paths: ["/app", "/desk"] },
  sales: {
    label: "Продажи",
    paths: ["/crm", "/my-leads", "/chat", "/kpi", "/analytics"],
  },
  service: { label: "Сервис", paths: ["/booking", "/reports"] },
  operations: { label: "Операции", paths: ["/finance"] },
  team: { label: "Команда", paths: ["/employees", "/tasks", "/messenger"] },
  settings: { label: "Настройки", paths: ["/integrations", "/audit", "/onboarding"] },
} as const;

export type FinanceTabId = "overview" | "accounting" | "reports" | "accountant" | "receivables";

export const FINANCE_SUBROUTES: { path: string; tab: FinanceTabId; label: string }[] = [
  { path: "/finance", tab: "overview", label: "Обзор" },
  { path: "/finance/accounting", tab: "accounting", label: "Учёт" },
  { path: "/finance/accountant", tab: "accountant", label: "Бухгалтерия" },
  { path: "/finance/receivables", tab: "receivables", label: "Дебиторка" },
  { path: "/finance/reports", tab: "reports", label: "Отчёты" },
];

export function financeTabFromPath(pathname: string): FinanceTabId {
  if (pathname.startsWith("/finance/accounting")) return "accounting";
  if (pathname.startsWith("/finance/accountant")) return "accountant";
  if (pathname.startsWith("/finance/receivables")) return "receivables";
  if (pathname.startsWith("/finance/inventory")) return "overview";
  if (pathname.startsWith("/finance/reports")) return "reports";
  return "overview";
}

export function financeTabsForRole(role: string | null): typeof FINANCE_SUBROUTES {
  if (role === "accountant") {
    return FINANCE_SUBROUTES.filter((t) => t.tab === "accountant" || t.tab === "reports" || t.tab === "receivables");
  }
  if (role === "finance_analyst") {
    return FINANCE_SUBROUTES.filter((t) => t.tab === "overview" || t.tab === "reports" || t.tab === "receivables");
  }
  return FINANCE_SUBROUTES;
}
