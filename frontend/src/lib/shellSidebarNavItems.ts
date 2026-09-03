import type { NavIconVariant } from "@/components/GradientIconBox";

export type ShellSidebarIconKey =
  | "bar-chart"
  | "calendar"
  | "check-square"
  | "clipboard-list"
  | "funnel"
  | "id-card"
  | "layout-dashboard"
  | "map-pin"
  | "message-circle"
  | "plug"
  | "target"
  | "user-round"
  | "users"
  | "wallet";

export type ShellSidebarNavItem = {
  id: string;
  to: string;
  end?: boolean;
  title: string;
  labelShort: string;
  labelFull: string;
  variant: NavIconVariant;
  iconKey: ShellSidebarIconKey;
};

type BuildParams = {
  isSuperOwner: boolean;
  isManagerNav: boolean;
  isExpert: boolean;
  isChiefExpert: boolean;
  isAdministrator?: boolean;
  isCurator?: boolean;
  isAccountant?: boolean;
  showFinance: boolean;
  showExpenses?: boolean;
  showIntegrationsHub: boolean;
  showKpi: boolean;
  bookingEnabled?: boolean;
  deskSalesEnabled?: boolean;
  chatStagesEnabled?: boolean;
  /** Доп услуги — только owner / admin / administrator */
  showExtraServices?: boolean;
  showNavForFeature: (feature: string) => boolean;
  navLex: {
    navKanban: string;
    navKanbanTitle: string;
    navGuests: string;
    navGuestsTitle: string;
    navKpi: string;
    navKpiTitle: string;
    navFinance: string;
    navFinanceTitle: string;
    navOwnerHomeShort: string;
    navOwnerHomeTitle: string;
    navAnalytics: string;
    navAnalyticsTitle: string;
  };
};


function extraServicesNavItem(): ShellSidebarNavItem {
  return {
    id: "extra-services",
    to: "/extra-services",
    title: "Доп услуги",
    labelShort: "Доп",
    labelFull: "Доп услуги",
    variant: "indigo",
    iconKey: "clipboard-list",
  };
}

export function buildShellSidebarNavItems(params: BuildParams): ShellSidebarNavItem[] {
  const {
    isSuperOwner,
    isManagerNav,
    isExpert,
    isChiefExpert,
    isAdministrator = false,
    isCurator = false,
    isAccountant = false,
    showFinance,
    showExpenses = false,
    showIntegrationsHub,
    showKpi,
    bookingEnabled = true,
    deskSalesEnabled = false,
    chatStagesEnabled: _chatStagesEnabled = true,
    showExtraServices = false,
    showNavForFeature,
    navLex,
  } = params;

  const managerLikeNav = isManagerNav || (isExpert && isChiefExpert);
  const showFinanceNav = showFinance || isChiefExpert;
  const showIntegrationsNav = showIntegrationsHub || isChiefExpert;
  const showBooking = bookingEnabled && showNavForFeature("booking");
  const showDeskSales = deskSalesEnabled && (isManagerNav || !isExpert);
  // Канбан снова доступен менеджерам (чат со стадиями не скрывает воронку).
  const hideKanbanForManager = false;
  void _chatStagesEnabled;

  if (isSuperOwner) {
    return [
      {
        id: "companies",
        to: "/companies",
        title: "Компании",
        labelShort: "Компании",
        labelFull: "Компании",
        variant: "purple",
        iconKey: "users",
      },
    ];
  }

  // Куратор: только онлайн-запись + дебиторка (KPI вкладка)
  if (isCurator) {
    const items: ShellSidebarNavItem[] = [];
    if (showBooking) {
      items.push({
        id: "booking",
        to: "/booking",
        title: "Онлайн-записи",
        labelShort: "Онлайн",
        labelFull: "Онлайн-запись",
        variant: "online",
        iconKey: "calendar",
      });
      if (showExtraServices) items.push(extraServicesNavItem());
    }
    if (showKpi && showNavForFeature("kpi")) {
      items.push({
        id: "kpi",
        to: "/kpi",
        title: "Дебиторка",
        labelShort: "Долги",
        labelFull: "Дебиторка курсов",
        variant: "indigo",
        iconKey: "target",
      });
    }
    return items;
  }

  // Администратор клиники: чаты, канбан, онлайн-запись, KPI
  if (isAdministrator) {
    const items: ShellSidebarNavItem[] = [];
    if (showNavForFeature("chat")) {
      items.push({
        id: "chat",
        to: "/chat",
        title: "Чаты",
        labelShort: "Чаты",
        labelFull: "Чаты",
        variant: "chat",
        iconKey: "message-circle",
      });
    }
    if (showNavForFeature("crm")) {
      items.push({
        id: "crm",
        to: "/crm",
        title: navLex.navKanbanTitle,
        labelShort: navLex.navKanban,
        labelFull: navLex.navKanbanTitle,
        variant: "crm",
        iconKey: "funnel",
      });
    }
    if (showBooking) {
      items.push({
        id: "booking",
        to: "/booking",
        title: "Онлайн-записи",
        labelShort: "Онлайн",
        labelFull: "Онлайн-запись",
        variant: "online",
        iconKey: "calendar",
      });
      if (showExtraServices) items.push(extraServicesNavItem());
    }
    if (showKpi && showNavForFeature("kpi")) {
      items.push({
        id: "kpi",
        to: "/kpi",
        title: navLex.navKpiTitle,
        labelShort: navLex.navKpi,
        labelFull: navLex.navKpiTitle,
        variant: "indigo",
        iconKey: "target",
      });
    }
    return items;
  }

  // Бухгалтер: финансы (отчёт компании) + расходы
  if (isAccountant) {
    const items: ShellSidebarNavItem[] = [];
    if (showFinanceNav && showNavForFeature("finance")) {
      items.push({
        id: "finance",
        to: "/finance",
        title: "Финансы",
        labelShort: "Финансы",
        labelFull: "Финансы — отчёт компании",
        variant: "blue",
        iconKey: "wallet",
      });
    }
    if (showExpenses) {
      items.push({
        id: "expenses",
        to: "/expenses",
        title: "Расходы",
        labelShort: "Расходы",
        labelFull: "Расходы",
        variant: "indigo",
        iconKey: "clipboard-list",
      });
    }
    return items;
  }

  if (managerLikeNav) {
    const items: ShellSidebarNavItem[] = [];
    if (showNavForFeature("chat") && hideKanbanForManager) {
      items.push({
        id: "chat",
        to: "/chat",
        title: "Чаты",
        labelShort: "Чаты",
        labelFull: "Чаты",
        variant: "chat",
        iconKey: "message-circle",
      });
    }
    items.push({
      id: "desk",
      to: "/desk",
      title: "Рабочий стол",
      labelShort: "Стол",
      labelFull: "Рабочий стол",
      variant: "crm",
      iconKey: "layout-dashboard",
    });
    if (showNavForFeature("chat") && !hideKanbanForManager) {
      items.push({
        id: "chat",
        to: "/chat",
        title: "Чаты",
        labelShort: "Чаты",
        labelFull: "Чаты",
        variant: "chat",
        iconKey: "message-circle",
      });
    }
    if (showBooking && !showDeskSales) {
      items.push({
        id: "booking",
        to: "/booking",
        title: "Онлайн-записи",
        labelShort: "Онлайн",
        labelFull: "Онлайн-запись",
        variant: "online",
        iconKey: "calendar",
      });
      if (showExtraServices) items.push(extraServicesNavItem());
    }
    if (showDeskSales) {
      items.push(
        {
          id: "quote",
          to: "/quote",
          title: "Калькуляция",
          labelShort: "Калькул.",
          labelFull: "Калькуляция",
          variant: "indigo",
          iconKey: "clipboard-list",
        },
        {
          id: "tracker",
          to: "/tracker",
          title: "Трекер",
          labelShort: "Трекер",
          labelFull: "Трекер визитов",
          variant: "blue",
          iconKey: "map-pin",
        },
        {
          id: "desk-sales",
          to: "/sales",
          title: "Продажи",
          labelShort: "Продажи",
          labelFull: "Продажи",
          variant: "online",
          iconKey: "wallet",
        },
      );
      if (showBooking) {
        items.push({
          id: "booking-sales",
          to: "/booking",
          title: "Онлайн-запись",
          labelShort: "Запись",
          labelFull: "Онлайн-запись",
          variant: "online",
          iconKey: "calendar",
        });
        if (showExtraServices) items.push(extraServicesNavItem());
      }
      if (showKpi && showNavForFeature("kpi")) {
        items.push({
          id: "kpi",
          to: "/kpi",
          title: navLex.navKpiTitle,
          labelShort: navLex.navKpi,
          labelFull: navLex.navKpiTitle,
          variant: "indigo",
          iconKey: "target",
        });
      }
    }
    if (showNavForFeature("crm") && !showDeskSales && !hideKanbanForManager) {
      items.push(
        {
          id: "crm",
          to: "/crm",
          title: navLex.navKanbanTitle,
          labelShort: navLex.navKanban,
          labelFull: navLex.navKanbanTitle,
          variant: "crm",
          iconKey: "funnel",
        },
        {
          id: "my-leads",
          to: "/my-leads",
          title: navLex.navGuestsTitle,
          labelShort: navLex.navGuests,
          labelFull: navLex.navGuestsTitle,
          variant: "indigo",
          iconKey: "user-round",
        },
      );
    }
    if ((showDeskSales || hideKanbanForManager) && showNavForFeature("crm")) {
      // Менеджер работает в чатах; канбан — у владельца. Список «Лиды» оставляем.
      items.push({
        id: "my-leads",
        to: "/my-leads",
        title: navLex.navGuestsTitle,
        labelShort: navLex.navGuests,
        labelFull: navLex.navGuestsTitle,
        variant: "indigo",
        iconKey: "user-round",
      });
    }
    if (showNavForFeature("tasks")) {
      items.push({
        id: "tasks",
        to: "/tasks",
        title: "Задачи",
        labelShort: "Задачи",
        labelFull: "Задачи",
        variant: "tasks",
        iconKey: "check-square",
      });
    }
    items.push({
      id: "messenger",
      to: "/messenger",
      title: "Мессенджер",
      labelShort: "Мессендж.",
      labelFull: "Мессенджер",
      variant: "tasks",
      iconKey: "users",
    });
    if (showKpi && showNavForFeature("kpi") && !showDeskSales) {
      items.push({
        id: "kpi",
        to: "/kpi",
        title: navLex.navKpiTitle,
        labelShort: navLex.navKpi,
        labelFull: navLex.navKpiTitle,
        variant: "indigo",
        iconKey: "target",
      });
    }
    if (showFinanceNav && showNavForFeature("finance")) {
      items.push({
        id: "finance",
        to: "/finance",
        title: navLex.navFinanceTitle,
        labelShort: navLex.navFinance,
        labelFull: navLex.navFinanceTitle,
        variant: "blue",
        iconKey: "wallet",
      });
    }
    if (showExpenses) {
      items.push({
        id: "expenses",
        to: "/expenses",
        title: "Расходы",
        labelShort: "Расходы",
        labelFull: "Расходы",
        variant: "indigo",
        iconKey: "clipboard-list",
      });
    }
    if (isChiefExpert && bookingEnabled && showNavForFeature("reports")) {
      items.push({
        id: "reports",
        to: "/reports",
        title: "Отчёты",
        labelShort: "Отчёты",
        labelFull: "Отчёты",
        variant: "blue",
        iconKey: "bar-chart",
      });
    }
    if (showNavForFeature("employees")) {
      items.push({
        id: "employees",
        to: "/employees",
        title: "Сотрудники",
        labelShort: "Сотр.",
        labelFull: "Сотрудники",
        variant: "purple",
        iconKey: "id-card",
      });
    }
    if (showIntegrationsNav && showNavForFeature("integrations")) {
      items.push({
        id: "integrations",
        to: "/integrations",
        title: "Интеграции",
        labelShort: "Интегр.",
        labelFull: "Интеграции",
        variant: "integrations",
        iconKey: "plug",
      });
    }
    return items;
  }

  if (isExpert) {
    const items: ShellSidebarNavItem[] = [];
    if (showBooking) {
      items.push({
        id: "booking",
        to: "/booking",
        title: "Онлайн-записи",
        labelShort: "Онлайн",
        labelFull: "Онлайн-запись",
        variant: "tasks",
        iconKey: "calendar",
      });
      if (showExtraServices) items.push(extraServicesNavItem());
    }
    if (bookingEnabled && showNavForFeature("reports")) {
      items.push({
        id: "reports",
        to: "/reports",
        title: "Отчёты",
        labelShort: "Отчёты",
        labelFull: "Отчёты",
        variant: "blue",
        iconKey: "bar-chart",
      });
    }
    if (showNavForFeature("chat")) {
      items.push({
        id: "chat",
        to: "/chat",
        title: "Чаты",
        labelShort: "Чаты",
        labelFull: "Чаты",
        variant: "tasks",
        iconKey: "message-circle",
      });
    }
    if (showNavForFeature("tasks")) {
      items.push({
        id: "tasks",
        to: "/tasks",
        title: "Задачи",
        labelShort: "Задачи",
        labelFull: "Задачи",
        variant: "purple",
        iconKey: "check-square",
      });
    }
    items.push({
      id: "messenger",
      to: "/messenger",
      title: "Мессенджер",
      labelShort: "Мессендж.",
      labelFull: "Мессенджер",
      variant: "tasks",
      iconKey: "users",
    });
    return items;
  }

  const items: ShellSidebarNavItem[] = [];
  if (showNavForFeature("crm")) {
    items.push({
      id: "app",
      to: "/app",
      end: true,
      title: navLex.navOwnerHomeTitle,
      labelShort: navLex.navOwnerHomeShort,
      labelFull: navLex.navOwnerHomeTitle,
      variant: "indigo",
      iconKey: "funnel",
    });
  }
  if (showBooking) {
    items.push({
      id: "booking",
      to: "/booking",
      title: "Онлайн-записи",
      labelShort: "Онлайн",
      labelFull: "Онлайн-запись",
      variant: "tasks",
      iconKey: "calendar",
    });
    if (showExtraServices) items.push(extraServicesNavItem());
  }
  if (showDeskSales) {
    items.push(
      {
        id: "quote",
        to: "/quote",
        title: "Калькуляция",
        labelShort: "Калькул.",
        labelFull: "Калькуляция",
        variant: "indigo",
        iconKey: "clipboard-list",
      },
      {
        id: "tracker",
        to: "/tracker",
        title: "Трекер",
        labelShort: "Трекер",
        labelFull: "Трекер визитов",
        variant: "blue",
        iconKey: "map-pin",
      },
      {
        id: "desk-sales",
        to: "/sales",
        title: "Продажи",
        labelShort: "Продажи",
        labelFull: "Продажи",
        variant: "online",
        iconKey: "wallet",
      },
    );
    if (showKpi && showNavForFeature("kpi")) {
      items.push({
        id: "kpi",
        to: "/kpi",
        title: navLex.navKpiTitle,
        labelShort: navLex.navKpi,
        labelFull: navLex.navKpiTitle,
        variant: "indigo",
        iconKey: "target",
      });
    }
  }
  if (showNavForFeature("tasks")) {
    items.push({
      id: "tasks",
      to: "/tasks",
      title: "Задачи",
      labelShort: "Задачи",
      labelFull: "Задачи",
      variant: "purple",
      iconKey: "check-square",
    });
  }
  items.push({
    id: "messenger",
    to: "/messenger",
    title: "Мессенджер",
    labelShort: "Мессендж.",
    labelFull: "Мессенджер",
    variant: "tasks",
    iconKey: "users",
  });
  if (showKpi && showNavForFeature("kpi") && !showDeskSales) {
    items.push({
      id: "kpi",
      to: "/kpi",
      title: navLex.navKpiTitle,
      labelShort: navLex.navKpi,
      labelFull: navLex.navKpiTitle,
      variant: "indigo",
      iconKey: "target",
    });
  }
  if (showNavForFeature("analytics")) {
    items.push({
      id: "analytics",
      to: "/analytics",
      title: navLex.navAnalyticsTitle,
      labelShort: navLex.navAnalytics,
      labelFull: navLex.navAnalyticsTitle,
      variant: "blue",
      iconKey: "bar-chart",
    });
  }
  if (showFinance && showNavForFeature("finance")) {
    items.push({
      id: "finance",
      to: "/finance",
      title: navLex.navFinanceTitle,
      labelShort: navLex.navFinance,
      labelFull: navLex.navFinanceTitle,
      variant: "blue",
      iconKey: "wallet",
    });
  }
  if (showExpenses) {
    items.push({
      id: "expenses",
      to: "/expenses",
      title: "Расходы",
      labelShort: "Расходы",
      labelFull: "Расходы",
      variant: "indigo",
      iconKey: "clipboard-list",
    });
  }
  if (showNavForFeature("employees")) {
    items.push({
      id: "employees",
      to: "/employees",
      title: "Сотрудники",
      labelShort: "Сотр.",
      labelFull: "Сотрудники",
      variant: "purple",
      iconKey: "id-card",
    });
  }
  if (showNavForFeature("chat")) {
    items.push({
      id: "chat",
      to: "/chat",
      title: "Чаты",
      labelShort: "Чаты",
      labelFull: "Чаты",
      variant: "tasks",
      iconKey: "message-circle",
    });
  }
  if (showNavForFeature("audit")) {
    items.push({
      id: "audit",
      to: "/audit",
      title: "Аудит",
      labelShort: "Аудит",
      labelFull: "Аудит",
      variant: "blue",
      iconKey: "bar-chart",
    });
  }
  if (showIntegrationsHub && showNavForFeature("integrations")) {
    items.push({
      id: "integrations",
      to: "/integrations",
      title: "Интеграции",
      labelShort: "Интегр.",
      labelFull: "Интеграции",
      variant: "integrations",
      iconKey: "plug",
    });
  }
  return items;
}

/** Пункты, которые уходят в меню «Настройки» / «Скрыть». */
export const SHELL_SETTINGS_ITEM_IDS = new Set([
  "messenger",
  "tasks",
  "finance",
  "analytics",
  "services",
  "employees",
  "audit",
  "integrations",
]);

export function partitionShellSidebarNavItems(items: ShellSidebarNavItem[]): {
  main: ShellSidebarNavItem[];
  settings: ShellSidebarNavItem[];
} {
  const main: ShellSidebarNavItem[] = [];
  const settings: ShellSidebarNavItem[] = [];
  for (const item of items) {
    if (SHELL_SETTINGS_ITEM_IDS.has(item.id)) settings.push(item);
    else main.push(item);
  }
  return { main, settings };
}

export function mergeShellSidebarOrder(defaultIds: string[], saved: string[] | null): string[] {
  if (!saved?.length) return defaultIds;
  const valid = new Set(defaultIds);
  const ordered: string[] = [];
  for (const id of saved) {
    if (valid.has(id) && !ordered.includes(id)) ordered.push(id);
  }
  for (const id of defaultIds) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}
