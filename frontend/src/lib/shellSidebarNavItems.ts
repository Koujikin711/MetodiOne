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
  alsoCurator?: boolean;
  alsoExpert?: boolean;
  isAccountant?: boolean;
  isRop?: boolean;
  showFinance: boolean;
  showExpenses?: boolean;
  showMarketing?: boolean;
  showIntegrationsHub: boolean;
  showKpi: boolean;
  bookingEnabled?: boolean;
  deskSalesEnabled?: boolean;
  chatStagesEnabled?: boolean;
  /** Доп услуги — только owner / admin / administrator */
  showExtraServices?: boolean;
  /** Журнал куратора для admin (в manager-like nav) */
  showCuratorJournal?: boolean;
  /** Только роль manager: пункт «Сотрудники» не показываем. */
  hideEmployees?: boolean;
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
    variant: "trainer",
    iconKey: "clipboard-list",
  };
}

function expertWindowNavItem(): ShellSidebarNavItem {
  return {
    id: "reports",
    to: "/reports",
    title: "Окно эксперта",
    labelShort: "Эксперт",
    labelFull: "Окно эксперта",
    variant: "blue",
    iconKey: "bar-chart",
  };
}

function curatorJournalNavItem(): ShellSidebarNavItem {
  return {
    id: "curator-journal",
    to: "/curator-journal",
    title: "Журнал куратора — успеваемость",
    labelShort: "Журнал",
    labelFull: "Журнал куратора",
    variant: "purple",
    iconKey: "check-square",
  };
}

function medicalCardNavItem(): ShellSidebarNavItem {
  return {
    id: "medical-card",
    to: "/medical-card",
    title: "Электронная мед. карта",
    labelShort: "Мед.",
    labelFull: "Мед. карта",
    variant: "teal",
    iconKey: "id-card",
  };
}

function pushClinicalCareNav(items: ShellSidebarNavItem[]) {
  items.push(curatorJournalNavItem());
  items.push(medicalCardNavItem());
}

export function buildShellSidebarNavItems(params: BuildParams): ShellSidebarNavItem[] {
  const {
    isSuperOwner,
    isManagerNav,
    isExpert,
    isChiefExpert,
    isAdministrator = false,
    isCurator = false,
    alsoCurator = false,
    alsoExpert = false,
    isAccountant = false,
    isRop = false,
    showFinance,
    showExpenses = false,
    showMarketing = false,
    showIntegrationsHub,
    showKpi,
    bookingEnabled = true,
    deskSalesEnabled = false,
    chatStagesEnabled: _chatStagesEnabled = true,
    showExtraServices = false,
    showCuratorJournal = false,
    hideEmployees = false,
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

  // РОП: только кабинет продаж
  if (isRop) {
    return [
      {
        id: "rop-dashboard",
        to: "/rop",
        end: true,
        title: "Дашборд РОП",
        labelShort: "Дашборд",
        labelFull: "Дашборд",
        variant: "platform",
        iconKey: "layout-dashboard",
      },
      {
        id: "rop-stats",
        to: "/rop/stats",
        title: "Статистика менеджеров",
        labelShort: "Стат",
        labelFull: "Статистика",
        variant: "trainer",
        iconKey: "bar-chart",
      },
      {
        id: "rop-distribute",
        to: "/rop/distribute",
        title: "Распределение лидов",
        labelShort: "Раздача",
        labelFull: "Распределение",
        variant: "purple",
        iconKey: "users",
      },
      {
        id: "rop-analytics",
        to: "/rop/analytics",
        title: "Аналитика ответа и выручки",
        labelShort: "Анализ",
        labelFull: "Аналитика",
        variant: "chat",
        iconKey: "target",
      },
      {
        id: "rop-report",
        to: "/rop/report",
        title: "Отчёт по выручке",
        labelShort: "Отчёт",
        labelFull: "Отчёт",
        variant: "online",
        iconKey: "wallet",
      },
      {
        id: "rop-outlook",
        to: "/rop/outlook",
        title: "Прогноз отдела продаж",
        labelShort: "Прогноз",
        labelFull: "Прогноз",
        variant: "trainer",
        iconKey: "target",
      },
      {
        id: "rop-search",
        to: "/rop/search",
        title: "Поиск пациента",
        labelShort: "Поиск",
        labelFull: "Поиск",
        variant: "online",
        iconKey: "user-round",
      },
      {
        id: "kpi",
        to: "/kpi",
        title: navLex.navKpiTitle,
        labelShort: navLex.navKpi,
        labelFull: navLex.navKpiTitle,
        variant: "platform",
        iconKey: "target",
      },
    ];
  }

  // Куратор: онлайн-запись + журнал куратора + дебиторка
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
    pushClinicalCareNav(items);
    if (showKpi && showNavForFeature("kpi")) {
      items.push({
        id: "kpi",
        to: "/kpi",
        title: "Дебиторка",
        labelShort: "Долги",
        labelFull: "Дебиторка курсов",
        variant: "platform",
        iconKey: "target",
      });
    }
    return items;
  }

  // Администратор клиники: только онлайн-запись, доп. услуги, журнал куратора
  if (isAdministrator) {
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
    pushClinicalCareNav(items);
    return items;
  }

  // Бухгалтер: расходы, чаты, канбан, запись, KPI, журнал, сотрудники
  if (isAccountant) {
    const items: ShellSidebarNavItem[] = [];
    if (showExpenses) {
      items.push({
        id: "expenses",
        to: "/expenses",
        title: "Расходы",
        labelShort: "Расходы",
        labelFull: "Расходы",
        variant: "finance",
        iconKey: "wallet",
      });
    }
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
        variant: "platform",
        iconKey: "target",
      });
    }
    pushClinicalCareNav(items);
    if (showNavForFeature("employees")) {
      items.push({
        id: "employees",
        to: "/employees",
        title: "Сотрудники",
        labelShort: "Команда",
        labelFull: "Сотрудники",
        variant: "tariff",
        iconKey: "id-card",
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
          variant: "platform",
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
      variant: "teal",
      iconKey: "users",
    });
    if (showKpi && showNavForFeature("kpi") && !showDeskSales) {
      items.push({
        id: "kpi",
        to: "/kpi",
        title: navLex.navKpiTitle,
        labelShort: navLex.navKpi,
        labelFull: navLex.navKpiTitle,
        variant: "platform",
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
        variant: "finance",
        iconKey: "wallet",
      });
    }
    if (showMarketing) {
      items.push({
        id: "marketing",
        to: "/marketing",
        title: "Маркетинг",
        labelShort: "Маркет.",
        labelFull: "Маркетинг · Meta Ads",
        variant: "purple",
        iconKey: "bar-chart",
      });
    }
    if ((isChiefExpert || alsoExpert) && bookingEnabled && showNavForFeature("reports")) {
      items.push(expertWindowNavItem());
    }
    if (showNavForFeature("employees") && !hideEmployees) {
      items.push({
        id: "employees",
        to: "/employees",
        title: "Сотрудники",
        labelShort: "Сотр.",
        labelFull: "Сотрудники",
        variant: "tariff",
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
    if (showCuratorJournal) pushClinicalCareNav(items);
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
    if (!alsoCurator && bookingEnabled && showNavForFeature("reports")) {
      items.push(
        alsoExpert
          ? expertWindowNavItem()
          : {
              id: "reports",
              to: "/reports",
              title: "Отчёты",
              labelShort: "Отчёты",
              labelFull: "Отчёты",
              variant: "blue",
              iconKey: "bar-chart",
            },
      );
    }
    if (!alsoCurator && showNavForFeature("chat")) {
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
    if (alsoCurator) {
      pushClinicalCareNav(items);
    }
    return items;
  }

  // Владелец / общий clinic: порядок финально сортирует SHELL_MAIN_PRIORITY.
  const items: ShellSidebarNavItem[] = [];
  if (showNavForFeature("crm")) {
    items.push({
      id: "app",
      to: "/app",
      end: true,
      title: navLex.navOwnerHomeTitle,
      labelShort: navLex.navOwnerHomeShort,
      labelFull: navLex.navOwnerHomeTitle,
      variant: "crm",
      iconKey: "funnel",
    });
  }
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
  if (showKpi && showNavForFeature("kpi")) {
    items.push({
      id: "kpi",
      to: "/kpi",
      title: navLex.navKpiTitle,
      labelShort: navLex.navKpi,
      labelFull: navLex.navKpiTitle,
      variant: "platform",
      iconKey: "target",
    });
  }
  items.push({
    id: "rop-cabinet",
    to: "/rop",
    title: "Кабинет РОП",
    labelShort: "РОП",
    labelFull: "Кабинет РОП",
    variant: "platform",
    iconKey: "layout-dashboard",
  });
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
  pushClinicalCareNav(items);
  if (showDeskSales) {
    items.push(
      {
        id: "quote",
        to: "/quote",
        title: "Калькуляция",
        labelShort: "Калькул.",
        labelFull: "Калькуляция",
        variant: "finance",
        iconKey: "wallet",
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
  }
  if (showExpenses) {
    items.push({
      id: "expenses",
      to: "/expenses",
      title: "Расходы",
      labelShort: "Расходы",
      labelFull: "Расходы",
      variant: "finance",
      iconKey: "wallet",
    });
  }
  if (showMarketing) {
    items.push({
      id: "marketing",
      to: "/marketing",
      title: "Маркетинг",
      labelShort: "Маркет.",
      labelFull: "Маркетинг · Meta Ads",
      variant: "purple",
      iconKey: "bar-chart",
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
    variant: "teal",
    iconKey: "users",
  });
  if (showNavForFeature("analytics")) {
    items.push({
      id: "analytics",
      to: "/analytics",
      title: navLex.navAnalyticsTitle,
      labelShort: navLex.navAnalytics,
      labelFull: navLex.navAnalyticsTitle,
      variant: "analytics",
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
  if (showNavForFeature("employees")) {
    items.push({
      id: "employees",
      to: "/employees",
      title: "Сотрудники",
      labelShort: "Сотр.",
      labelFull: "Сотрудники",
      variant: "tariff",
      iconKey: "id-card",
    });
  }
  if (showNavForFeature("audit")) {
    items.push({
      id: "audit",
      to: "/audit",
      title: "Аудит",
      labelShort: "Аудит",
      labelFull: "Аудит",
      variant: "platform",
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

/**
 * Приоритет главного меню: чем меньше — тем выше.
 * Ориентир — дневные клики: воронка/чаты → деньги → клиника → реже.
 */
export const SHELL_MAIN_PRIORITY: Record<string, number> = {
  companies: 1,
  // Продажи / коммуникация
  app: 10,
  crm: 10,
  chat: 20,
  desk: 25,
  "my-leads": 30,
  "sales-control": 32,
  // Деньги и контроль отдела
  kpi: 40,
  "rop-cabinet": 45,
  "rop-dashboard": 45,
  "rop-distribute": 46,
  "rop-search": 47,
  "rop-stats": 48,
  "rop-report": 49,
  "rop-analytics": 50,
  "rop-outlook": 51,
  // Клиника (ежедневный поток)
  booking: 60,
  "booking-sales": 60,
  "extra-services": 65,
  "curator-journal": 70,
  "medical-card": 75,
  reports: 78,
  quote: 80,
  tracker: 81,
  "desk-sales": 82,
  // Реже
  expenses: 90,
  marketing: 95,
};

/** Приоритет блока «Скрыть» / настройки. */
export const SHELL_SETTINGS_PRIORITY: Record<string, number> = {
  analytics: 10,
  finance: 20,
  employees: 30,
  tasks: 40,
  messenger: 50,
  audit: 60,
  integrations: 70,
  services: 80,
};

/** Куратор / администратор: запись и карты важнее KPI. */
export const SHELL_CLINICAL_MAIN_PRIORITY: Record<string, number> = {
  booking: 10,
  "extra-services": 20,
  "curator-journal": 30,
  "medical-card": 40,
  kpi: 50,
  chat: 60,
  crm: 70,
  expenses: 80,
  employees: 90,
};

/** Менеджер: чаты — главный рабочий экран. */
export const SHELL_MANAGER_MAIN_PRIORITY: Record<string, number> = {
  chat: 10,
  desk: 15,
  crm: 20,
  "my-leads": 25,
  "sales-control": 28,
  kpi: 35,
  booking: 40,
  "booking-sales": 40,
  "extra-services": 45,
  "curator-journal": 50,
  "medical-card": 55,
  quote: 60,
  tracker: 61,
  "desk-sales": 62,
  reports: 65,
  expenses: 70,
  marketing: 80,
  "rop-cabinet": 90,
};

export type ShellNavPriorityProfile = "default" | "clinical" | "rop" | "manager";

function priorityMapFor(profile: ShellNavPriorityProfile): Record<string, number> {
  if (profile === "clinical") return SHELL_CLINICAL_MAIN_PRIORITY;
  if (profile === "manager") return SHELL_MANAGER_MAIN_PRIORITY;
  return SHELL_MAIN_PRIORITY;
}

function sortByPriority(items: ShellSidebarNavItem[], priority: Record<string, number>): ShellSidebarNavItem[] {
  return [...items].sort((a, b) => {
    const pa = priority[a.id] ?? 500;
    const pb = priority[b.id] ?? 500;
    if (pa !== pb) return pa - pb;
    return 0;
  });
}

export function partitionShellSidebarNavItems(
  items: ShellSidebarNavItem[],
  profile: ShellNavPriorityProfile = "default",
): {
  main: ShellSidebarNavItem[];
  settings: ShellSidebarNavItem[];
} {
  const main: ShellSidebarNavItem[] = [];
  const settings: ShellSidebarNavItem[] = [];
  for (const item of items) {
    if (SHELL_SETTINGS_ITEM_IDS.has(item.id)) settings.push(item);
    else main.push(item);
  }
  return {
    main: sortByPriority(main, priorityMapFor(profile)),
    settings: sortByPriority(settings, SHELL_SETTINGS_PRIORITY),
  };
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
