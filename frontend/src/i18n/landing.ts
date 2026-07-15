export type LandingLang = "en" | "ru";

export const LANDING_LANG_KEY = "mo-landing-lang";

export function detectLandingLang(): LandingLang {
  try {
    const saved = localStorage.getItem(LANDING_LANG_KEY);
    if (saved === "en" || saved === "ru") return saved;
  } catch {
    /* ignore */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "en";
  return nav.startsWith("ru") || nav.startsWith("tg") ? "ru" : "en";
}

const dict = {
  en: {
    brand: "MetodiOne",
    brandSub: "Studio",
    navAudience: "For whom",
    navWork: "What we build",
    navProducts: "Portfolio",
    navCases: "Cases",
    navDemos: "Live demos",
    navEngage: "Engagement",
    navOffer: "Offer",
    navContact: "Contact",
    navInvestors: "Investors",
    ctaDemos: "Explore live demos",
    ctaContact: "Book discovery",
    ctaLogin: "CRM login",
    ctaInvestors: "Investor brief",
    ctaOffer: "Book discovery call",
    heroHeadline: "Your process → a working system → proof you can click",
    heroLead:
      "We design and ship individual systems for companies, teams and private businesses — from a sharp tool to a full ERP. Open a sandbox the same day.",
    heroProofLive: "Live sandboxes",
    heroProofLine: "Fuel · WhatsApp OCR · CRM · HR · warehouses",
    heroProofCaption: "Named products. Real UIs. Separate demo databases.",
    audienceTitle: "Built for decision-makers who need systems, not slides",
    audienceLead:
      "We partner with businesses that outgrew spreadsheets, founders who need a product-shaped operations core, and individuals who want a reliable system around their craft. Every build starts from your process — not a catalogue forced onto it.",
    audienceItems: [
      {
        t: "Companies & holdings",
        d: "Industry processes, multi-role access, warehouses, finance documents, reporting — one coherent product instead of a patchwork of SaaS.",
      },
      {
        t: "Growing teams & founders",
        d: "CRM, booking, messengers and KPI tied to your real funnel — shipped as a product your team can adopt in days, not quarters of consulting theatre.",
      },
      {
        t: "Specialists & private businesses",
        d: "Tailored desks for a bakery, boutique, workshop or personal ops — ownership of the logic, not a rented template that breaks at the first exception.",
      },
    ],
    customTitle: "Individual custom applications — any scale of complexity",
    customLead:
      "Every engagement starts from your process. We do not force a generic catalogue onto your business. You get software shaped around people, documents and decisions that already exist in your organization.",
    customItems: [
      {
        t: "From a sharp wedge to a full stack",
        d: "A WhatsApp automation, a warehouse desk, a multi-currency trading ERP or a multi-tenant CRM — we choose the smallest scope that moves the business, then expand without rewrites.",
      },
      {
        t: "Web, desktop and messenger layers",
        d: "Browser products, installable operator clients, OCR from photos, WeChat/WhatsApp bridges — whichever channel your teams already live in.",
      },
      {
        t: "Owned systems you can demonstrate",
        d: "Clean product naming, stable demos, roles and audit trails. Suitable to show investors, partners and operators the same truth: the product exists and runs.",
      },
    ],
    whatTitle: "What we create",
    whatLead:
      "Operational platforms for organizations that sell, manufacture, store, hire and serve — with the engineering depth of a product studio, not a one-off freelance script.",
    whatItems: [
      {
        t: "Industry ERPs & warehouses",
        d: "Fuel wholesale, furniture production, confectionery, fashion retail, auto-parts stock, client trading desks — documents, FIFO, posting, prints and roles.",
      },
      {
        t: "CRM, booking & customer ops",
        d: "Pipelines, omnichannel chat, online scheduling, multi-tenant SaaS shapes and KPI that management can trust.",
      },
      {
        t: "Automation & bridges",
        d: "WeChat / WhatsApp operator desks, weighbridge OCR from group photos, installable bridges and Alerts for people processes (HR, visas, payroll).",
      },
      {
        t: "Private & sensitive builds",
        d: "Closed client systems with controlled demos — when the process cannot sit on a public SaaS, we still deliver a professional product story.",
      },
    ],
    productsTitle: "Selected systems in market language",
    productsLead:
      "A living portfolio of products we designed, built and can open for you. Names are market-facing; each one maps to a real operational domain.",
    openDemo: "Enter sandbox",
    openDemoInstant: "Enter without password",
    viewAllDemos: "Open demo hub",
    statusLive: "Live demo",
    statusStarting: "Starting up",
    statusDesktop: "Desktop / private",
    statusPrivate: "On request",
    statusShowcase: "Showcase",
    casesTitle: "Delivery cases",
    casesLead:
      "Real operational pain, what we shipped, and how the business ran differently. Anonymized — built for diligence, not vanity percentages.",
    caseProblem: "The problem",
    caseDid: "What we did",
    caseResult: "Business impact",
    caseImpact: "What changed",
    casesShowMore: "Show all cases",
    casesShowLess: "Show fewer",
    casesMoreHint: "more in the full portfolio",
    offerTitle: "How we engage",
    offerLead: "One path from first call to evidence your stakeholders can reopen.",
    offerItems: [
      {
        t: "30-minute discovery",
        d: "Roles, documents, the outcome that matters. Scoped recommendation and a demo path — no deck theater.",
      },
      {
        t: "Product brief in 5–10 days",
        d: "Screens, data model options and milestones. You leave with a written shape of the system.",
      },
      {
        t: "Pilot in 2–4 weeks",
        d: "A working slice in production or sandbox — train the team, reopen for the next review.",
      },
    ],
    offerCta: "Request discovery slot",
    offerStripTitle: "The offer in one line",
    demosTitle: "Proof you can click — live sandbox demos",
    demosLead:
      "Investors and partners should not rely on mockups. Enter a second door into running environments with sample data. Credentials are published in the hub for self-serve walkthroughs.",
    demosHubCta: "Enter the demo hub",
    investTitle: "Why MetodiOne for capital conversations",
    investLead:
      "We build products that can be named, shown and operated. That is the difference between a services pitch and a studio that has already shipped multiple vertical systems.",
    investItems: [
      {
        t: "Execution evidence",
        d: "Multiple live demos across ERP, CRM, messengers and HR — evidence of delivery velocity and domain range.",
      },
      {
        t: "Reusable craft, unique products",
        d: "Shared engineering discipline with product-shaped outcomes: each client gets an individual application, not a white-label skin.",
      },
      {
        t: "Conversation-ready",
        d: "Bilingual RU/EN narrative, market names and a public demo hub make diligence and partner reviews faster.",
      },
    ],
    contactTitle: "Tell us what must work better",
    contactLead:
      "Describe the business, the people involved and the outcome you need — for an internal ops system, a product for customers, or a personal workflow. We will propose shape, timeline and a demo path.",
    contactName: "Name",
    contactCompany: "Company / project",
    contactEmail: "Email",
    contactPhone: "Phone / WhatsApp",
    contactMessage: "Process, goals, constraints",
    contactSend: "Send request",
    contactSending: "Sending…",
    contactClose: "Close",
    footerNote:
      "MetodiOne Studio — custom operational software for businesses, teams and individuals. Demo environments use sandbox data, not client production.",
    demoDisclaimer: "Demo environments use sandbox data and may restart without notice.",
    copyLogin: "Copy login",
    copied: "Copied",
    backHome: "Back to studio",
    demosPageTitle: "Demo hub",
    demosPageLead:
      "Second entrance into MetodiOne systems — open a product, sign in with the demo account, and walk the real UI. Sandbox only.",
    noPublicDemo: "No public URL yet — request a live walkthrough.",
    requestPrivate: "Request private demo",
    openShowcase: "Open showcase",
    industriesTitle: "Industry pages",
    backStudio: "Studio home",
    printPdf: "Print / save PDF",
    investorsTitle: "Investor brief",
    investorsLead:
      "MetodiOne Studio builds and runs individual operational applications — CRM, ERP, messenger automation and HR — with live demos capital partners can inspect.",
    investorsWhatTitle: "What the studio is",
    investorsWhat:
      "A product engineering studio: we diagnose real workflows, ship named systems, and keep sandbox environments for diligence. Brand MetodiOne stands for the studio, not a single personal freelance offer.",
    investorsLineTitle: "Product line (market names)",
    investorsModelTitle: "Money model",
    investorsModelItems: [
      {
        t: "Project delivery",
        d: "Scoped custom builds billed by milestones — discovery, MVP, rollout. Ownership of the delivered application sits with the client unless otherwise agreed.",
      },
      {
        t: "Productized verticals",
        d: "Reusable craft packaged as market products (FuelOps, ScaleGate, StaffDesk…). Faster starts when the domain matches a proven core.",
      },
      {
        t: "Retention & iteration",
        d: "Hosting, support, training and feature iterations after go-live — recurring revenue tied to systems that stay in daily use.",
      },
    ],
    investorsRoadTitle: "Roadmap of scale",
    investorsRoadItems: [
      {
        t: "Now",
        d: "Public studio site, bilingual narrative, demo hub, live Amvera sandboxes, watchdog for uptime, investor brief page.",
      },
      {
        t: "Next",
        d: "Dedicated sandboxes with isolated demo DBs, web demos for BakeFlow / Atelier / ClientOps, stronger case metrics under NDA.",
      },
      {
        t: "Then",
        d: "Partner channel for industry verticals, standardized pricing packs, and capital narrative backed by retention of production systems.",
      },
    ],
    showcaseRequest: "Request live sandbox",
    showcaseModules: "Modules",
    showcaseAudience: "Built for",
  },
  ru: {
    brand: "MetodiOne",
    brandSub: "Studio",
    navAudience: "Для кого",
    navWork: "Что создаём",
    navProducts: "Портфолио",
    navCases: "Кейсы",
    navDemos: "Живые демо",
    navEngage: "Как работаем",
    navOffer: "Оффер",
    navContact: "Контакт",
    navInvestors: "Инвесторам",
    ctaDemos: "Смотреть живые демо",
    ctaContact: "Записаться на discovery",
    ctaLogin: "Вход в CRM",
    ctaInvestors: "Бриф для инвестора",
    ctaOffer: "Записаться на discovery",
    heroHeadline: "Ваш процесс → рабочая система → доказательство в один клик",
    heroLead:
      "Проектируем и выпускаем индивидуальные системы для компаний, команд и личного бизнеса — от точного инструмента до ERP. Sandbox можно открыть в тот же день.",
    heroProofLive: "Живые sandbox",
    heroProofLine: "Топливо · WhatsApp OCR · CRM · кадры · склады",
    heroProofCaption: "Рыночные имена. Реальные UI. Отдельные демо-БД.",
    audienceTitle: "Для тех, кому нужны рабочие системы, а не слайды",
    audienceLead:
      "Мы работаем с бизнесом, который вырос из Excel; с основателями, которым нужен операционный каркас продукта; и с частными заказчиками, которым нужна надёжная система вокруг своего дела. Каждый проект начинается с вашего процесса — без натягивания чужого каталога.",
    audienceItems: [
      {
        t: "Компании и холдинги",
        d: "Отраслевые процессы, роли, склад, финансы, отчёты — один цельный продукт вместо набора чужих SaaS, которые не сходятся в операциях.",
      },
      {
        t: "Растущие команды и основатели",
        d: "CRM, запись, мессенджеры и KPI под вашу воронку — продукт, который команда начинает использовать за дни, а не после месяцев «консалтинга».",
      },
      {
        t: "Специалисты и личный бизнес",
        d: "Рабочие места для кондитерской, бутика, мастерской или личного операционного контура — логика ваша, а не арендованный шаблон с поломкой на первом исключении.",
      },
    ],
    customTitle: "Индивидуальные приложения — любой уровень сложности",
    customLead:
      "Каждый проект начинается с вашего процесса. Мы не натягиваем чужой каталог на ваш бизнес. Вы получаете ПО вокруг людей, документов и решений, которые уже есть в организации.",
    customItems: [
      {
        t: "От точного клина до полного контура",
        d: "Автоматизация WhatsApp, складское рабочее место, мультивалютная торговая ERP или мультитенант CRM — начинаем с того, что двигает деньги, и расширяем без «переписывания с нуля».",
      },
      {
        t: "Web, desktop и слой мессенджеров",
        d: "Браузерные продукты, устанавливаемые клиенты операторов, OCR с фото, мосты WeChat/WhatsApp — там, где уже живёт команда.",
      },
      {
        t: "Системы, которые можно показать",
        d: "Понятные рыночные имена, стабильные демо, роли и аудит. Одинаково убедительно для инвестора, партнёра и операционного руководителя: продукт существует и работает.",
      },
    ],
    whatTitle: "Что мы создаём",
    whatLead:
      "Операционные платформы для организаций, которые продают, производят, хранят, нанимают и обслуживают — с глубиной продуктовой студии, а не разового скрипта «под ключ за выходные».",
    whatItems: [
      {
        t: "Отраслевые ERP и склады",
        d: "Опт топлива, мебельное производство, кондитерка, fashion-retail, склады автозапчастей, торговые столы клиентов — документы, FIFO, проведение, печать и роли.",
      },
      {
        t: "CRM, запись и клиентский контур",
        d: "Воронки, омниканал-чат, онлайн-запись, мультитенант SaaS и KPI, которым можно доверять на управленческом уровне.",
      },
      {
        t: "Автоматизация и мосты",
        d: "Рабочие места WeChat / WhatsApp, OCR весов с фото в группах, устанавливаемые мосты и кадровые системы с оповещениями (визы, табель, зарплата).",
      },
      {
        t: "Закрытые и чувствительные внедрения",
        d: "Клиентские системы без публичного SaaS — при этом с профессиональной продуктовой подачей и демо по запросу.",
      },
    ],
    productsTitle: "Системы в рыночных именах",
    productsLead:
      "Живое портфолио продуктов, которые мы спроектировали, собрали и можем открыть вам. Имена — для рынка; за каждым — реальная предметная область.",
    openDemo: "Войти в sandbox",
    openDemoInstant: "Войти без пароля",
    viewAllDemos: "Открыть демо-хаб",
    statusLive: "Live демо",
    statusStarting: "Запускается",
    statusDesktop: "Desktop / закрытое",
    statusPrivate: "По запросу",
    statusShowcase: "Showcase",
    casesTitle: "Кейсы внедрений",
    casesLead:
      "Реальная операционная боль, что собрали и как иначе стал работать бизнес. Анонимно — для due diligence, без выдуманных «+400%».",
    caseProblem: "Проблема",
    caseDid: "Что сделали",
    caseResult: "Влияние на бизнес",
    caseImpact: "Что изменилось",
    casesShowMore: "Показать все кейсы",
    casesShowLess: "Свернуть",
    casesMoreHint: "ещё в полной линейке",
    offerTitle: "Как мы работаем",
    offerLead: "Один путь от первого звонка до доказательств, которые можно открыть снова.",
    offerItems: [
      {
        t: "Discovery 30 минут",
        d: "Роли, документы, нужный исход. Рекомендация по скоупу и путь к демо — без театра слайдов.",
      },
      {
        t: "Бриф продукта за 5–10 дней",
        d: "Экраны, модель данных и вехи. На руках — письменная форма системы.",
      },
      {
        t: "Пилот за 2–4 недели",
        d: "Рабочий срез в проде или песочнице — обучение команды и повторный показ на разборе.",
      },
    ],
    offerCta: "Запросить слот discovery",
    offerStripTitle: "Оффер в одну строку",
    demosTitle: "Доказательство кликом — живые песочницы",
    demosLead:
      "Инвесторам и партнёрам не нужны макеты. Второй вход — в работающие среды с тестовыми данными. Логины опубликованы в хабе для самостоятельного прохождения.",
    demosHubCta: "Войти в демо-хаб",
    investTitle: "Почему MetodiOne уместен в разговоре с капиталом",
    investLead:
      "Мы делаем продукты, которые можно назвать, показать и эксплуатировать. Это отличие студии с линейкой готовых вертикальных систем от сервиса, который продаёт только обещания.",
    investItems: [
      {
        t: "Доказательства исполнения",
        d: "Несколько живых демо по ERP, CRM, мессенджерам и HR — видимая скорость и ширина доменов.",
      },
      {
        t: "Ремесло общее — продукты уникальные",
        d: "Общая инженерная дисциплина и продуктовый исход: каждый заказчик получает индивидуальное приложение, а не «перекрашенный шаблон».",
      },
      {
        t: "Готовность к due diligence",
        d: "Билингвальный RU/EN нарратив, рыночные имена и публичный демо-хаб ускоряют проверку партнёрами и инвесторами.",
      },
    ],
    contactTitle: "Расскажите, что должно работать лучше",
    contactLead:
      "Опишите бизнес, людей и нужный результат — внутреннюю систему, продукт для клиентов или личный процесс. Предложим форму, сроки и путь к демо.",
    contactName: "Имя",
    contactCompany: "Компания / проект",
    contactEmail: "Email",
    contactPhone: "Телефон / WhatsApp",
    contactMessage: "Процесс, цели, ограничения",
    contactSend: "Отправить",
    contactSending: "Отправка…",
    contactClose: "Закрыть",
    footerNote:
      "MetodiOne Studio — индивидуальное операционное ПО для бизнеса, команд и частных заказчиков. Демо на песочных данных, не на проде клиентов.",
    demoDisclaimer: "Демо на песочных данных; инстансы могут перезапускаться.",
    copyLogin: "Копировать логин",
    copied: "Скопировано",
    backHome: "На главную студии",
    demosPageTitle: "Демо-хаб",
    demosPageLead:
      "Второй вход в системы MetodiOne — откройте продукт, войдите демо-аккаунтом и пройдите реальный интерфейс. Только песочница.",
    noPublicDemo: "Публичного URL пока нет — запросите живой разбор.",
    requestPrivate: "Запросить закрытое демо",
    openShowcase: "Открыть showcase",
    industriesTitle: "Отраслевые страницы",
    backStudio: "На главную студии",
    printPdf: "Печать / сохранить PDF",
    investorsTitle: "Бриф для инвестора",
    investorsLead:
      "MetodiOne Studio собирает и сопровождает индивидуальные операционные приложения — CRM, ERP, автоматизацию мессенджеров и HR — с живыми демо, которые можно проверить.",
    investorsWhatTitle: "Что такое студия",
    investorsWhat:
      "Продуктовая инженерная студия: диагностируем реальные процессы, выпускаем именные системы и держим песочницы для diligence. Бренд MetodiOne — про студию, а не разовый фриланс.",
    investorsLineTitle: "Линейка продуктов (рыночные имена)",
    investorsModelTitle: "Модель денег",
    investorsModelItems: [
      {
        t: "Проектная поставка",
        d: "Кастомные сборки по вехам — discovery, MVP, rollout. Владение поставленным приложением у клиента, если не договорено иначе.",
      },
      {
        t: "Продуктивизированные вертикали",
        d: "Общее ремесло в рыночных продуктах (FuelOps, ScaleGate, StaffDesk…). Быстрый старт, когда домен совпадает с проверенным ядром.",
      },
      {
        t: "Retention и итерации",
        d: "Хостинг, поддержка, обучение и доработки после запуска — регулярная выручка от систем в ежедневной эксплуатации.",
      },
    ],
    investorsRoadTitle: "Roadmap масштабирования",
    investorsRoadItems: [
      {
        t: "Сейчас",
        d: "Публичный сайт студии, билингвальный нарратив, демо-хаб, живые Amvera-песочницы, watchdog аптайма, страница инвестора.",
      },
      {
        t: "Дальше",
        d: "Отдельные sandbox с изолированными demo-БД, web-демо BakeFlow / Atelier / ClientOps, метрики кейсов под NDA.",
      },
      {
        t: "Затем",
        d: "Партнёрский канал по вертикалям, стандартизованные пакеты цен и капитальный нарратив на retention боевых систем.",
      },
    ],
    showcaseRequest: "Запросить живой sandbox",
    showcaseModules: "Модули",
    showcaseAudience: "Для кого",
  },
} as const;

export type LandingCopy = (typeof dict)["en"];

export function landingCopy(lang: LandingLang): LandingCopy {
  return dict[lang] as LandingCopy;
}

export function statusLabel(
  lang: LandingLang,
  status: "live" | "starting" | "desktop" | "private" | "showcase",
): string {
  const t = landingCopy(lang);
  if (status === "live") return t.statusLive;
  if (status === "starting") return t.statusStarting;
  if (status === "desktop") return t.statusDesktop;
  if (status === "showcase") return t.statusShowcase;
  return t.statusPrivate;
}
