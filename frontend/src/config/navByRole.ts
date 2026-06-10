/** Группы навигации по зонам продукта (для документации и будущего рефакторинга сайдбара). */
export const NAV_ZONES = {
  home: { label: "Главная", paths: ["/app", "/desk"] },
  sales: {
    label: "Продажи",
    paths: ["/crm", "/my-leads", "/chat", "/kpi", "/analytics"],
  },
  service: { label: "Сервис", paths: ["/booking", "/reports"] },
  team: { label: "Команда", paths: ["/employees", "/tasks", "/messenger"] },
  settings: { label: "Настройки", paths: ["/integrations", "/audit", "/onboarding"] },
} as const;
