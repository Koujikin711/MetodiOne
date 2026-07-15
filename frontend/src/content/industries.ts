export type IndustryPage = {
  slug: string;
  title: { en: string; ru: string };
  lead: { en: string; ru: string };
  bullets: { en: string; ru: string }[];
  productIds: string[];
  seoTitle: { en: string; ru: string };
};

export const INDUSTRY_PAGES: IndustryPage[] = [
  {
    slug: "fuel-erp",
    title: {
      en: "Fuel wholesale ERP",
      ru: "ERP оптовой торговли топливом",
    },
    lead: {
      en: "Operational ERP for distributors who buy, store and sell fuel with multi-currency documents and accountable journals.",
      ru: "Операционная ERP для дистрибьюторов топлива: покупка, хранение, продажа, мультивалютные документы и подотчётные журналы.",
    },
    bullets: [
      {
        en: "Purchases, sales, bank and tank-aware posting",
        ru: "Поступления, реализации, банк и учёт с привязкой к резервуарам",
      },
      {
        en: "Printable multi-currency forms that match the ledger",
        ru: "Печатные формы в валюте договора, согласованные с журналом",
      },
      {
        en: "Live sandbox for diligence and operator training",
        ru: "Живая песочница для проверки и обучения операторов",
      },
    ],
    productIds: ["fuelops"],
    seoTitle: {
      en: "Fuel ERP for wholesale traders | MetodiOne Studio",
      ru: "ERP топлива для опта | MetodiOne Studio",
    },
  },
  {
    slug: "whatsapp-automation",
    title: {
      en: "WhatsApp & messenger automation",
      ru: "Автоматизация WhatsApp и мессенджеров",
    },
    lead: {
      en: "Turn group photos and chat traffic into structured operations — weighbridges, operator desks and bridges that survive real field use.",
      ru: "Превращаем фото из групп и чат-трафик в структурированные операции — весовые, столы операторов и мосты, которые выдерживают поле.",
    },
    bullets: [
      {
        en: "OCR and workflows from WhatsApp groups",
        ru: "OCR и процессы из WhatsApp-групп",
      },
      {
        en: "WeChat / WhatsApp bridges with installable clients",
        ru: "Мосты WeChat / WhatsApp с устанавливаемыми клиентами",
      },
      {
        en: "Roles, history and demos investors can click",
        ru: "Роли, история и демо, в которые можно кликнуть",
      },
    ],
    productIds: ["scalegate", "messagehub"],
    seoTitle: {
      en: "WhatsApp automation for operations | MetodiOne Studio",
      ru: "Автоматизация WhatsApp для операций | MetodiOne Studio",
    },
  },
  {
    slug: "crm-booking",
    title: {
      en: "CRM, chat & online booking",
      ru: "CRM, чат и онлайн-запись",
    },
    lead: {
      en: "Product-shaped CRM for service businesses: pipelines, omnichannel chat, booking and KPI with multi-tenant readiness.",
      ru: "Продуктовая CRM для сервисного бизнеса: воронки, омниканал, запись и KPI с готовностью к мультитенанту.",
    },
    bullets: [
      {
        en: "Stages, roles and manager desk",
        ru: "Стадии, роли и рабочее место менеджера",
      },
      {
        en: "Booking linked to the same customer truth",
        ru: "Онлайн-запись на той же клиентской правде",
      },
      {
        en: "Suitable for guided investor demos",
        ru: "Удобно для guided-демо инвестору",
      },
    ],
    productIds: ["metodione-crm", "messagehub"],
    seoTitle: {
      en: "CRM and booking platform | MetodiOne Studio",
      ru: "CRM и онлайн-запись | MetodiOne Studio",
    },
  },
  {
    slug: "warehouse-erp",
    title: {
      en: "Warehouse & production ERP",
      ru: "Склад и производство — ERP",
    },
    lead: {
      en: "FIFO stock, multi-line documents, posting discipline and operator roles for factories and parts warehouses.",
      ru: "FIFO-склад, мультистрочные документы, дисциплина проведения и роли для производств и складов запчастей.",
    },
    bullets: [
      {
        en: "Furniture, auto-parts and trading desks",
        ru: "Мебель, автозапчасти и торговые столы",
      },
      {
        en: "Audit-friendly posting / unposting",
        ru: "Проведение / отмена с аудитом",
      },
      {
        en: "Sandbox hosts for stakeholder reviews",
        ru: "Песочницы для разбора с заинтересованными сторонами",
      },
    ],
    productIds: ["craftline", "partstock", "tradedesk"],
    seoTitle: {
      en: "Warehouse ERP systems | MetodiOne Studio",
      ru: "Складские ERP-системы | MetodiOne Studio",
    },
  },
  {
    slug: "hr-system",
    title: {
      en: "HR department system",
      ru: "Система отдела кадров",
    },
    lead: {
      en: "People cards, timesheets, leave, orders and foreign-worker alerts with TJ/RU/EN interfaces.",
      ru: "Карточки сотрудников, табель, отпуска, приказы и оповещения по иностранным работникам — интерфейсы TJ/RU/EN.",
    },
    bullets: [
      {
        en: "Roles from inspector to management",
        ru: "Роли от инспектора до руководства",
      },
      {
        en: "Payroll and report exports",
        ru: "Зарплата и выгрузки отчётов",
      },
      {
        en: "Live demo for process walkthroughs",
        ru: "Живое демо для разбора процесса",
      },
    ],
    productIds: ["staffdesk"],
    seoTitle: {
      en: "HR system for people ops | MetodiOne Studio",
      ru: "HR-система для кадрового учёта | MetodiOne Studio",
    },
  },
  {
    slug: "confectionery-erp",
    title: {
      en: "Confectionery ERP",
      ru: "ERP кондитерской",
    },
    lead: {
      en: "Recipes, ingredient stock and order confirmation with automatic write-off — product story and private walkthrough.",
      ru: "Техкарты, склад сырья и подтверждение заказа с автосписанием — продуктовая история и закрытый разбор.",
    },
    bullets: [
      {
        en: "Costing tied to recipes",
        ru: "Себестоимость от техкарт",
      },
      {
        en: "Order → stock movement in one action",
        ru: "Заказ → движение склада одним действием",
      },
      {
        en: "Showcase now, full sandbox on request",
        ru: "Сейчас — обзор, полная песочница по запросу",
      },
    ],
    productIds: ["bakeflow"],
    seoTitle: {
      en: "Confectionery ERP | MetodiOne Studio",
      ru: "ERP кондитерской | MetodiOne Studio",
    },
  },
  {
    slug: "retail-erp",
    title: {
      en: "Fashion retail ERP",
      ru: "ERP для fashion-ритейла",
    },
    lead: {
      en: "SKU / size / color truth for boutiques — warehouse, sales floor and finance in one product narrative.",
      ru: "Правда SKU / размер / цвет для бутиков — склад, зал и финансы в одном продуктовом рассказе.",
    },
    bullets: [
      {
        en: "Catalog discipline for apparel",
        ru: "Дисциплина каталога для одежды",
      },
      {
        en: "Sales and stock in sync",
        ru: "Продажи и склад в связке",
      },
      {
        en: "Showcase page + private demo path",
        ru: "Страница обзора и путь к закрытому демо",
      },
    ],
    productIds: ["atelier"],
    seoTitle: {
      en: "Fashion boutique ERP | MetodiOne Studio",
      ru: "ERP fashion-бутика | MetodiOne Studio",
    },
  },
  {
    slug: "custom-ops",
    title: {
      en: "Custom operational systems",
      ru: "Кастомные операционные системы",
    },
    lead: {
      en: "When off-the-shelf SaaS cannot hold your exceptions — individual applications with evidence you can show capital partners.",
      ru: "Когда готовый SaaS не держит ваши исключения — индивидуальные приложения с доказательствами для капитала.",
    },
    bullets: [
      {
        en: "Process-first scoping",
        ru: "Сначала процесс, потом экран",
      },
      {
        en: "Any complexity, controlled rollout",
        ru: "Любая сложность, управляемый rollout",
      },
      {
        en: "Private demos under NDA when needed",
        ru: "Закрытые демо под NDA при необходимости",
      },
    ],
    productIds: ["clientops"],
    seoTitle: {
      en: "Custom ops software | MetodiOne Studio",
      ru: "Заказное операционное ПО | MetodiOne Studio",
    },
  },
];

export function getIndustry(slug: string): IndustryPage | undefined {
  return INDUSTRY_PAGES.find((p) => p.slug === slug);
}
