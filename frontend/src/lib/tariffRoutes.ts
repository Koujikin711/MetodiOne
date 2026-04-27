/** Соответствие пути SPA ключу функции тарифа (как на бэкенде). */

const ROUTE_FEATURE: [string, string][] = [
  ["/app", "crm"],
  ["/finance", "finance"],
  ["/integrations", "integrations"],
  ["/employees", "employees"],
  ["/attendance", "attendance"],
  ["/analytics", "analytics"],
  ["/booking", "booking"],
  ["/reports", "reports"],
  ["/audit", "audit"],
  ["/tasks", "tasks"],
  ["/chat", "chat"],
  ["/kpi", "kpi"],
  ["/horeca", "horeca"],
  ["/my-leads", "crm"],
  ["/crm", "crm"],
  ["/leads", "crm"],
];

const sorted = [...ROUTE_FEATURE].sort((a, b) => b[0].length - a[0].length);

export function pathToTariffFeature(pathname: string): string | null {
  for (const [prefix, key] of sorted) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return key;
  }
  return null;
}
