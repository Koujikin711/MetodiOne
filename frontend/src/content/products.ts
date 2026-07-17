export type DemoStatus = "live" | "starting" | "desktop" | "private" | "showcase";

export type StudioProduct = {
  id: string;
  name: string;
  tagline: { en: string; ru: string };
  blurb: { en: string; ru: string };
  tags: string[];
  /** Passwordless sandbox entry URL (opens app immediately). */
  demoUrl?: string;
  demoLogin?: { user: string; password: string; note?: { en: string; ru: string } };
  status: DemoStatus;
  industrySlugs?: string[];
  /** When true, hub hides password block — one-click /demo only. */
  instantDemo?: boolean;
};

const INSTANT = {
  en: "One click — sandbox DB, not client production.",
  ru: "Один клик — тестовая база, не боевая система клиента.",
} as const;

/** Portfolio catalog — market names (not client codenames). */
export const STUDIO_PRODUCTS: StudioProduct[] = [
  {
    id: "metodione-crm",
    name: "MetodiOne CRM",
    tagline: {
      en: "Sales pipelines, omnichannel chat, client booking and KPI",
      ru: "Воронки продаж, омниканальный чат, запись клиентов и KPI",
    },
    blurb: {
      en: "Multi-tenant CRM for growing teams: deal stages, WhatsApp/Telegram/Instagram integration, online booking, flexible roles and live analytics.",
      ru: "Мультитенантная CRM для растущих команд: стадии сделок, интеграция с WhatsApp/Telegram/Instagram, онлайн-запись, гибкие роли и живая аналитика.",
    },
    tags: ["CRM", "Chat", "Booking", "SaaS"],
    demoUrl: "/demo",
    status: "live",
    instantDemo: true,
    industrySlugs: ["crm-booking"],
  },
  {
    id: "fuelops",
    name: "FuelOps",
    tagline: {
      en: "Specialized ERP for wholesale fuel trade",
      ru: "Специализированная ERP для оптовой торговли топливом",
    },
    blurb: {
      en: "Receipts, sales, bank, journals, multi-currency documents and automatic tank accounting for distributors.",
      ru: "Поступления, реализации, банк, проводки, мультивалютные документы и автоматический учёт резервуаров для дистрибьюторов.",
    },
    tags: ["ERP", "Finance", "Fuel"],
    demoUrl: "https://benzobiznes-koujikin.amvera.io/demo",
    status: "live",
    instantDemo: true,
    industrySlugs: ["fuel-erp"],
  },
  {
    id: "messagehub",
    name: "MessageHub",
    tagline: {
      en: "CRM platform with WeChat integration and messenger bridges",
      ru: "CRM-платформа с интеграцией WeChat и мессенджер-мостами",
    },
    blurb: {
      en: "A unified WeChat/WhatsApp operator desk: counterparties, inbound webhooks, desktop bridges and fast install on the client’s infrastructure.",
      ru: "Единое рабочее место оператора WeChat/WhatsApp: ведение контрагентов, входящие вебхуки, десктоп-мосты и быстрая установка на мощностях клиента.",
    },
    tags: ["CRM", "WeChat", "WhatsApp"],
    demoUrl: "https://wechat-koujikin.amvera.io/demo",
    status: "live",
    instantDemo: true,
    industrySlugs: ["whatsapp-automation", "crm-booking"],
  },
  {
    id: "scalegate",
    name: "ScaleGate",
    tagline: {
      en: "Automated truck weighbridge accounting via WhatsApp",
      ru: "Автоматизированный учёт взвешивания грузовиков через WhatsApp",
    },
    blurb: {
      en: "Drivers send scale photos with captions; OCR reads weight, computes net, posts reports to the ops group.",
      ru: "Водители присылают фото табло с подписью; OCR снимает вес, считает нетто и публикует отчёт в группу.",
    },
    tags: ["WhatsApp", "OCR", "Logistics"],
    demoUrl: "https://bot-whatsapp-koujikin.amvera.io/demo",
    status: "live",
    instantDemo: true,
    industrySlugs: ["whatsapp-automation"],
  },
  {
    id: "craftline",
    name: "CraftLine",
    tagline: {
      en: "ERP for furniture production and warehouse management",
      ru: "ERP-система для управления мебельным производством и складом",
    },
    blurb: {
      en: "FIFO stock, multi-line docs, posting/unposting, PDF prints, roles and audit for furniture factories.",
      ru: "FIFO-склад, мультистрочные документы, проведение/отмена, PDF, роли и аудит для мебельных производств.",
    },
    tags: ["ERP", "Production", "WMS"],
    demoUrl: "https://mebel-erp-koujikin.amvera.io/demo",
    status: "live",
    instantDemo: true,
    industrySlugs: ["warehouse-erp"],
  },
  {
    id: "bakeflow",
    name: "BakeFlow",
    tagline: {
      en: "Confectionery ERP: tech cards, warehouse, auto write-off and orders",
      ru: "ERP для кондитерских производств: технологические карты, складской учёт, автоматическое списание и управление заказами",
    },
    blurb: {
      en: "Confectionery ERP: tech cards, warehouse accounting, automatic write-off and order management.",
      ru: "ERP для кондитерских производств: технологические карты, складской учёт, автоматическое списание и управление заказами.",
    },
    tags: ["ERP", "Food", "Showcase"],
    demoUrl: "/showcase/bakeflow",
    status: "showcase",
    industrySlugs: ["confectionery-erp"],
  },
  {
    id: "atelier",
    name: "Atelier Retail",
    tagline: {
      en: "Fashion boutique ERP: size, color and sell-through in one loop",
      ru: "ERP-система для fashion-бутиков: сквозной учет размеров, цветов и показателей sell-through",
    },
    blurb: {
      en: "Fashion boutique ERP: end-to-end tracking of sizes, colors and sell-through.",
      ru: "ERP-система для fashion-бутиков: сквозной учет размеров, цветов и показателей sell-through.",
    },
    tags: ["ERP", "Retail", "Showcase"],
    demoUrl: "/showcase/atelier",
    status: "showcase",
    industrySlugs: ["retail-erp"],
  },
  {
    id: "partstock",
    name: "PartStock",
    tagline: {
      en: "Specialized warehouse accounting for auto parts",
      ru: "Специализированный складской учёт автозапчастей",
    },
    blurb: {
      en: "Parts inventory, ops workflows and PIN profiles for spare-parts warehouses.",
      ru: "Номенклатура запчастей, операционные процессы и PIN-профили для складов автозапчастей.",
    },
    tags: ["WMS", "Auto parts"],
    /** Bridge → Nizom hash `/#/demo` (passwordless SPA entry). */
    demoUrl: "/enter/partstock",
    status: "live",
    instantDemo: true,
    industrySlugs: ["warehouse-erp"],
  },
  {
    id: "tradedesk",
    name: "TradeDesk",
    tagline: {
      en: "Custom operational ERP built around client business logic",
      ru: "Индивидуальная операционная ERP под бизнес-логику клиента",
    },
    blurb: {
      en: "Deployed operations desk tailored to a client trading workflow — sandbox demo host.",
      ru: "Операционное рабочее место под торговый процесс клиента — демо-хост.",
    },
    tags: ["ERP", "Ops"],
    /** Bridge → StarMIX `/demo` (passwordless after Amvera patch in amvera-patches/akmal). */
    demoUrl: "/enter/tradedesk",
    status: "live",
    instantDemo: true,
    industrySlugs: ["warehouse-erp"],
  },
  {
    id: "staffdesk",
    name: "StaffDesk",
    tagline: {
      en: "HR automation: employees, shift timesheets, payroll",
      ru: "Автоматизация отдела кадров: учёт сотрудников, табель смены, расчёт зарплаты",
    },
    blurb: {
      en: "Employee cards, org chart, timesheets, leave, orders, foreign-worker alerts and payroll reports (TJ/RU/EN).",
      ru: "Карточки сотрудников, оргструктура, табель, отпуска, приказы, оповещения по иностранным работникам и отчёты по зарплате (тоҷ/ру/en).",
    },
    tags: ["HR", "Payroll", "Reports"],
    demoUrl: "https://otdel-kadrov-koujikin.amvera.io/demo",
    status: "live",
    instantDemo: true,
    industrySlugs: ["hr-system"],
  },
  {
    id: "clientops",
    name: "ClientOps",
    tagline: {
      en: "Private custom delivery of a complex ops contour under NDA",
      ru: "Закрытый индивидуальный кейс внедрения сложного операционного контура под NDA",
    },
    blurb: {
      en: "A private custom delivery of a complex operational contour under NDA.",
      ru: "Закрытый индивидуальный кейс внедрения сложного операционного контура под NDA.",
    },
    tags: ["Custom", "Showcase"],
    demoUrl: "/showcase/clientops",
    status: "showcase",
    industrySlugs: ["custom-ops"],
  },
];

/** External Amvera sandbox hosts (for watchdog / ops). Bridge paths resolve here. */
const EXTERNAL_DEMO_HOSTS: Record<string, string> = {
  partstock: "https://nizom-koujikin.amvera.io/",
  tradedesk: "https://akmal-koujikin.amvera.io/",
};

export const LIVE_DEMO_TARGETS = STUDIO_PRODUCTS.filter(
  (p) => p.status === "live" && (p.demoUrl?.startsWith("http") || EXTERNAL_DEMO_HOSTS[p.id]),
).map((p) => {
  const url = p.demoUrl!.startsWith("http") ? p.demoUrl! : EXTERNAL_DEMO_HOSTS[p.id]!;
  return {
    id: p.id,
    name: p.name,
    url,
    slug: url.replace(/^https?:\/\//, "").split(".")[0],
  };
});

export const INSTANT_DEMO_NOTE = INSTANT;
