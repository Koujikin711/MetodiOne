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
  ru: "Один клик — sandbox-БД, не прод клиента.",
} as const;

/** Portfolio catalog — market names (not client codenames). */
export const STUDIO_PRODUCTS: StudioProduct[] = [
  {
    id: "metodione-crm",
    name: "MetodiOne CRM",
    tagline: {
      en: "Pipelines, omnichannel chat, booking, KPI",
      ru: "Воронки, омниканал-чат, запись, KPI",
    },
    blurb: {
      en: "Multi-tenant CRM for growing teams: stages, WhatsApp/Telegram/Instagram, online booking, roles and analytics.",
      ru: "Мультитенант CRM для растущих команд: стадии, WhatsApp/Telegram/Instagram, онлайн-запись, роли и аналитика.",
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
      en: "Wholesale fuel trade ERP",
      ru: "ERP оптовой торговли топливом",
    },
    blurb: {
      en: "Purchases, sales, bank, journals, multi-currency documents and tank accounting for fuel distributors.",
      ru: "Поступления, реализации, банк, проводки, мультивалютные документы и учёт резервуаров для дистрибьюторов топлива.",
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
      en: "CRM with WeChat & messenger bridges",
      ru: "CRM с WeChat и мессенджер-мостами",
    },
    blurb: {
      en: "Operator desk for WeChat/WhatsApp traffic: counterparties, inbound webhooks, desktop bridges, install flow.",
      ru: "Рабочее место оператора WeChat/WhatsApp: контрагенты, inbound webhooks, desktop-мосты, установка у клиента.",
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
      en: "Truck weighbridge automation via WhatsApp",
      ru: "Автоучёт взвешивания грузовиков из WhatsApp",
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
      en: "Furniture production & warehouse ERP",
      ru: "ERP мебельного производства и склада",
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
      en: "Confectionery ERP — recipes, stock, orders",
      ru: "ERP кондитерской — техкарты, склад, заказы",
    },
    blurb: {
      en: "Ingredient stock, recipe costing, order confirmation with auto stock write-off, sales and finance views.",
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
      en: "Fashion boutique ERP",
      ru: "ERP для fashion-бутика",
    },
    blurb: {
      en: "SKU / size / color catalog, warehouse, sales floor, analytics and finance for apparel retail.",
      ru: "Каталог SKU / размер / цвет, склад, продажи, аналитика и финансы для магазина одежды.",
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
      en: "Auto-parts warehouse system",
      ru: "Склад автозапчастей",
    },
    blurb: {
      en: "Parts inventory, ops workflows and PIN profiles for spare-parts warehouses.",
      ru: "Номенклатура запчастей, операционные процессы и PIN-профили для складов автозапчастей.",
    },
    tags: ["WMS", "Auto parts"],
    demoUrl: "https://nizom-koujikin.amvera.io/demo",
    status: "live",
    instantDemo: true,
    industrySlugs: ["warehouse-erp"],
  },
  {
    id: "tradedesk",
    name: "TradeDesk",
    tagline: {
      en: "Client operations ERP",
      ru: "Операционная ERP клиента",
    },
    blurb: {
      en: "Deployed operations desk tailored to a client trading workflow — sandbox demo host.",
      ru: "Операционное рабочее место под торговый процесс клиента — демо-хост.",
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
      en: "HR department system — people, attendance, payroll",
      ru: "Система отдела кадров — сотрудники, табель, зарплата",
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
      en: "Private delivery case",
      ru: "Закрытый кейс внедрения",
    },
    blurb: {
      en: "Custom ops suite delivered for a private client. Live public demo is available on request.",
      ru: "Кастомный операционный контур для клиента. Публичное демо — по запросу.",
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
