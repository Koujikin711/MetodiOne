/** Термины для режима HoReCa (ресторан) vs классический CRM. */

export type RestaurantLexicon = {
  leadPlural: string;
  leadCol: string;
  leadGenitive: string;
  leadCycle: string;
  funnel: string;
  sourcesTitle: string;
  analyticsTitle: string;
  financeBannerTitle: string;
  financeBannerBody: string;
  /** Подзаголовок под H1 на странице финансов */
  financePageIntro: string;
  navKanban: string;
  navKanbanTitle: string;
  /** Первый пункт меню владельца: ведёт на /app (экран CRM) */
  navOwnerHomeShort: string;
  navOwnerHomeTitle: string;
  navGuests: string;
  navGuestsTitle: string;
  /** Короткая подпись в нижней мобильной навигации */
  navGuestsShort: string;
  navKpi: string;
  navKpiTitle: string;
  navAnalytics: string;
  navAnalyticsTitle: string;
  navFinance: string;
  navFinanceTitle: string;
  navHoreca: string;
  navHorecaTitle: string;
  /** Подзаголовок страницы аналитики */
  analyticsIntro: string;
  /** Первая опция селекта воронок */
  pipelineAll: string;
  /** Заголовок блока таблицы стадий */
  sectionStageFlow: string;
  /** Заголовок блока план/факт */
  sectionPlanFact: string;
  /** Колонка «Менеджер» */
  thStaff: string;
  /** Колонка «Воронка» в полной аналитике */
  thPipelineOrOutlet: string;
  /** Префикс метрики «Лиды:» / «Гости / заказы:» */
  guestsMetricLabel: string;
  /** CSV: доля в источниках */
  csvLeadSharePct: string;
  /** CSV / подпись «Обработано менеджером» */
  processedByStaff: string;
};

export function restaurantLexicon(restaurantMode: boolean): RestaurantLexicon {
  if (!restaurantMode) {
    return {
      leadPlural: "Лидов",
      leadCol: "Лидов",
      leadGenitive: "лидов",
      leadCycle: "Цикл лида",
      funnel: "Воронка",
      sourcesTitle: "Источники лидов и деньги",
      analyticsTitle: "Аналитика",
      financeBannerTitle: "",
      financeBannerBody: "",
      financePageIntro:
        "Учётные политики, склад, журнал проводок и отложенная выручка. Доступ: владелец, админ, супер-владелец; финансовый аналитик — просмотр и отчёты без изменений.",
      navKanban: "Канбан",
      navKanbanTitle: "Канбан",
      navOwnerHomeShort: "CRM",
      navOwnerHomeTitle: "CRM и канбан",
      navGuests: "Мои лиды",
      navGuestsTitle: "Мои лиды",
      navGuestsShort: "Лиды",
      navKpi: "KPI",
      navKpiTitle: "KPI продаж",
      navAnalytics: "Аналит.",
      navAnalyticsTitle: "Аналитика",
      navFinance: "Финансы",
      navFinanceTitle: "Финансы",
      navHoreca: "HoReCa",
      navHorecaTitle: "HoReCa: ресторан",
      analyticsIntro:
        "Полная — по воронкам. Детальная — по менеджерам. Доступно только владельцу компании.",
      pipelineAll: "Все воронки",
      sectionStageFlow: "Конверсия по стадиям",
      sectionPlanFact: "План / факт по менеджерам",
      thStaff: "Менеджер",
      thPipelineOrOutlet: "Воронка",
      guestsMetricLabel: "Лиды",
      csvLeadSharePct: "Доля лидов %",
      processedByStaff: "Обработано менеджером",
    };
  }
  return {
    leadPlural: "Гостей / заказов",
    leadCol: "Гостей",
    leadGenitive: "гостей",
    leadCycle: "Путь гостя",
    funnel: "Этапы зала",
    sourcesTitle: "Каналы привлечения гостей и выручка",
    analyticsTitle: "Показатели зала",
    financeBannerTitle: "Режим HoReCa",
    financeBannerBody:
      "В ресторане в приоритете выручка смены, себестоимость (food cost), списания по техкартам и касса — не «лиды». " +
      "Ниже тот же финансовый модуль: проводки, склад, P&L; дальше свяжем автоматические списания по продажам блюд и производственные карты.",
    financePageIntro:
      "Склад, проводки, отчёность и контроль маржи — как в сети: один экран для владельца и бухгалтерии. Финансовый аналитик по-прежнему только смотрит.",
    navKanban: "Зал",
    navKanbanTitle: "Зал и заказы (канбан)",
    navOwnerHomeShort: "Зал / CRM",
    navOwnerHomeTitle: "Зал, CRM и канбан",
    navGuests: "Гости",
    navGuestsTitle: "База гостей",
    navGuestsShort: "Гости",
    navKpi: "KPI зала",
    navKpiTitle: "KPI смены и выручка",
    navAnalytics: "Показат.",
    navAnalyticsTitle: "Показатели зала и выручка",
    navFinance: "Финансы",
    navFinanceTitle: "Финансы заведения",
    navHoreca: "HoReCa",
    navHorecaTitle: "Центр HoReCa: зал, кухня, доставка",
    analyticsIntro:
      "Те же отчёты, что и в CRM, но термины — ресторанные: гости, зал, смена. Полная — по направлениям (зал / доставка / кейтеринг). Детальная — по сотрудникам смены.",
    pipelineAll: "Все направления",
    sectionStageFlow: "Поток гостей по этапам зала",
    sectionPlanFact: "План / факт по смене и хостам",
    thStaff: "Сотрудник / смена",
    thPipelineOrOutlet: "Направление / точка продаж",
    guestsMetricLabel: "Гости / заказы",
    csvLeadSharePct: "Доля гостей %",
    processedByStaff: "Принято сменой / хостом",
  };
}
