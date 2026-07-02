/** Термины интерфейса CRM (лиды, воронки, финансы). */

export type AppLexicon = {
  leadPlural: string;
  leadCol: string;
  leadGenitive: string;
  leadCycle: string;
  funnel: string;
  sourcesTitle: string;
  analyticsTitle: string;
  financeBannerTitle: string;
  financeBannerBody: string;
  financePageIntro: string;
  navKanban: string;
  navKanbanTitle: string;
  navOwnerHomeShort: string;
  navOwnerHomeTitle: string;
  navGuests: string;
  navGuestsTitle: string;
  navGuestsShort: string;
  navKpi: string;
  navKpiTitle: string;
  navAnalytics: string;
  navAnalyticsTitle: string;
  navFinance: string;
  navFinanceTitle: string;
  analyticsIntro: string;
  pipelineAll: string;
  sectionStageFlow: string;
  sectionPlanFact: string;
  thStaff: string;
  thPipelineOrOutlet: string;
  guestsMetricLabel: string;
  csvLeadSharePct: string;
  processedByStaff: string;
};

export const appLexicon: AppLexicon = {
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
    "Обзор, учёт, бухгалтерия (расходы и Gmail), дебиторка по этапам оплат и отчёты ОПУ/ОСВ/ДДС. Доступ: владелец, админ, бухгалтер, супер-владелец; финансовый аналитик — просмотр без изменений.",
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
