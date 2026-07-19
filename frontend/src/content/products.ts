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
  en: "Opens on test data.",
  ru: "Открывается на тестовых данных.",
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
      en: "A single WeChat/WhatsApp operator desk: counterparties, inbound webhooks, desktop bridges and a straightforward install on the client’s servers.",
      ru: "Единое рабочее место оператора WeChat/WhatsApp: контрагенты, входящие вебхуки, десктоп-мосты и установка на серверах клиента.",
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
      en: "Recipes, stock, automatic write-off and orders",
      ru: "Техкарты, склад, автосписание и заказы",
    },
    blurb: {
      en: "Ingredient stock, recipe costing, order confirmation with automatic write-off, plus sales and finance views.",
      ru: "Склад сырья, себестоимость техкарт, заказы с автосписанием, продажи и финансы.",
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
      en: "Size, color and sell-through in one system",
      ru: "Размер, цвет и sell-through в одной системе",
    },
    blurb: {
      en: "SKU catalog with size and color, warehouse and floor sales, owner analytics and finance views for apparel retail.",
      ru: "Каталог SKU с размером и цветом, склад и продажи в зале, аналитика владельца и финансы для fashion-ритейла.",
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
    /** Nizom passwordless entry (server /demo → SPA /#/demo). Always https so hub opens a new tab. */
    demoUrl: "https://nizom-koujikin.amvera.io/demo",
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
      en: "An operations desk built around a client trading workflow — catalog, stock, sales and roles.",
      ru: "Операционное рабочее место под торговый процесс клиента: каталог, склад, продажи и роли.",
    },
    tags: ["ERP", "Ops"],
    demoUrl: "https://akmal-koujikin.amvera.io/demo",
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
      en: "Private delivery of a custom operations system under NDA",
      ru: "Закрытая поставка операционной системы под NDA",
    },
    blurb: {
      en: "A privately scoped operations suite delivered under NDA. Public demo available on request.",
      ru: "Закрытый операционный контур под NDA. Публичное демо — по запросу.",
    },
    tags: ["Custom", "Showcase"],
    demoUrl: "/showcase/clientops",
    status: "showcase",
    industrySlugs: ["custom-ops"],
  },
];

export const LIVE_DEMO_TARGETS = STUDIO_PRODUCTS.filter(
  (p) => p.status === "live" && p.demoUrl?.startsWith("http"),
).map((p) => ({
  id: p.id,
  name: p.name,
  url: p.demoUrl!,
  slug: p.demoUrl!.replace(/^https?:\/\//, "").split(".")[0],
}));

export const INSTANT_DEMO_NOTE = INSTANT;
