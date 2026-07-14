export type StudioCase = {
  id: string;
  industry: { en: string; ru: string };
  problem: { en: string; ru: string };
  did: { en: string; ru: string };
  result: { en: string; ru: string };
  productIds: string[];
};

/** Anonymized delivery stories for investors / partners. */
export const STUDIO_CASES: StudioCase[] = [
  {
    id: "fuel-wholesale",
    industry: {
      en: "Wholesale fuel trade",
      ru: "Оптовая торговля топливом",
    },
    problem: {
      en: "Purchases, sales and bank docs lived in Excel + messenger screenshots. Multi-currency contracts drifted from tank reality; month-end took days and still disagreed.",
      ru: "Поступления, реализации и банк жили в Excel и скриншотах из мессенджеров. Мультивалютные контракты расходились с фактом по резервуарам; закрытие месяца занимало дни и всё равно не сходилось.",
    },
    did: {
      en: "Shipped FuelOps: document flow (purchases/sales/bank), journals, multi-currency print forms and tank-aware operations with role access — one operational desk instead of five tables.",
      ru: "Собрали FuelOps: контур документов (поступления/реализации/банк), журналы, мультивалютные печатные формы и учёт с ролями — одно рабочее место вместо пяти таблиц.",
    },
    result: {
      en: "Ops team posts documents the same day; finance reviews a single journal; stakeholder demos use a live sandbox, not a deck. Cycle time from “deal done” to “posted” dropped from days to hours.",
      ru: "Операции проводят документы в день сделки; финансы смотрят один журнал; стейкхолдерам показывают живой sandbox, а не слайды. От «сделка» до «проведено» — часы вместо дней.",
    },
    productIds: ["fuelops"],
  },
  {
    id: "weighbridge-whatsapp",
    industry: {
      en: "Logistics / weighbridge",
      ru: "Логистика / весовая",
    },
    problem: {
      en: "Drivers photographed the scale board into a WhatsApp group. Dispatchers typed weights by hand, net was argued verbally, and nobody trusted the daily total.",
      ru: "Водители слали фото табло весов в WhatsApp-группу. Диспетчеры перебивали вес вручную, нетто спорили голосом, дневному итогу никто не верил.",
    },
    did: {
      en: "Built ScaleGate: photo + caption intake, OCR for gross, net = current − previous, report back to the group with confirmation, web panel for history and roles.",
      ru: "Собрали ScaleGate: приём фото с подписью, OCR брутто, нетто = текущий − предыдущий, отчёт в группу с подтверждением, веб-панель истории и ролей.",
    },
    result: {
      en: "Weighings leave an auditable trail in minutes; disputes fall because the group sees the same numbers the panel stores. Ops stopped rebuilding the day in Excel at night.",
      ru: "Взвешивания дают аудируемый след за минуты; споры падают, потому что группа видит те же цифры, что панель. Ночной «сбор дня» в Excel исчез.",
    },
    productIds: ["scalegate"],
  },
];
