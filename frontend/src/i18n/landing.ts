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
    navDemos: "Demo",
    navEngage: "Engagement",
    navOffer: "Offer",
    navContact: "Contact",
    navInvestors: "Investors",
    ctaDemos: "Open demos",
    ctaContact: "Express audit request",
    ctaLogin: "CRM login",
    ctaInvestors: "Investor brief",
    ctaOffer: "Express audit request",
    heroHeadline: "Your process → a working system → proof you can click",
    heroLead:
      "We design and ship individual systems for companies, teams and private businesses — from a sharp tool to a full ERP. Open a sandbox the same day.",
    heroProofLive: "Live demos",
    heroProofLine: "FuelOps · ScaleGate · StaffDesk · MessageHub",
    heroProofCaption: "Market product names. Real interfaces. Separate demo databases.",
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
    productsTitle: "Products",
    productsLead:
      "A living portfolio of products we designed, built and can provide for you.",
    openDemo: "Enter demo",
    openDemoInstant: "Open demo",
    viewAllDemos: "All demos",
    statusLive: "Live",
    statusStarting: "Starting",
    statusDesktop: "Desktop / private",
    statusPrivate: "On request",
    statusShowcase: "Preview",
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
        t: "Express discovery (30 minutes)",
        d: "No long calls or dull presentations. We discuss roles directly, lock in the inputs, and define the right project scope. You leave with a clear action plan and a direct path to a demo.",
      },
      {
        t: "System design (5–10 days)",
        d: "We build a detailed map of the future product. You get interactive screens, a worked-out data model, and clear development milestones. Result — fully described system logic in your hands.",
      },
      {
        t: "Pilot launch (2–4 weeks)",
        d: "We deploy a working prototype in a live or test environment. We don’t just hand over code — we train your team and run a joint detailed review of the results.",
      },
    ],
    offerCta: "Express audit request",
    offerStripTitle: "The offer in one line",
    offerStripLink: "How it works",
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
    demoDisclaimer: "Sandboxes may restart; data resets.",
    copyLogin: "Copy login",
    copied: "Copied",
    backHome: "Back to studio",
    demosPageTitle: "Demo",
    demosVersionLabel: "Demo version",
    demosPageLead:
      "Open a running product in one click. Sandbox data only — separate from client production.",
    demosLiveTitle: "Ready to open",
    demosLiveLead: "Passwordless entry into working systems.",
    demosMoreLive: "More demos",
    demosShowcaseTitle: "Previews",
    demosShowcaseLead: "UI walkthrough when a full sandbox host is not public yet.",
    demosOtherTitle: "On request",
    noPublicDemo: "Available on request",
    requestPrivate: "Request private demo",
    openShowcase: "Open preview",
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
    brandSub: "Студия",
    navAudience: "Для кого",
    navWork: "Что создаём",
    navProducts: "Портфолио",
    navCases: "Кейсы",
    navDemos: "Демо",
    navEngage: "Как работаем",
    navOffer: "Предложение",
    navContact: "Контакт",
    navInvestors: "Инвесторам",
    ctaDemos: "Открыть демо",
    ctaContact: "Заявка на экспресс-аудит",
    ctaLogin: "Вход в CRM",
    ctaInvestors: "Для инвесторов",
    ctaOffer: "Заявка на экспресс-аудит",
    heroHeadline: "Ваш процесс → рабочая система → доказательство в один клик",
    heroLead:
      "Проектируем и выпускаем индивидуальные системы для компаний, команд и личного бизнеса — от точного инструмента до ERP. Песочницу можно открыть в тот же день.",
    heroProofLive: "Живые демо",
    heroProofLine: "FuelOps · ScaleGate · StaffDesk · MessageHub",
    heroProofCaption: "Рыночные имена продуктов. Реальные интерфейсы. Отдельные демо-базы.",
    audienceTitle: "Для тех, кому нужны рабочие системы, а не слайды",
    audienceLead:
      "Мы работаем с бизнесом, который вырос из Excel; с основателями, которым нужен операционный каркас продукта; и с частными заказчиками, которым нужна надёжная система вокруг своего дела. Каждый проект начинается с вашего процесса — без натягивания чужого каталога.",
    audienceItems: [
      {
        t: "Компании и холдинги",
        d: "Отраслевые процессы, роли, склад, финансы, отчёты — один цельный продукт вместо набора чужих сервисов, которые не сходятся в операциях.",
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
        t: "Веб, десктоп и мессенджеры",
        d: "Браузерные продукты, устанавливаемые клиенты операторов, распознавание с фото, мосты WeChat/WhatsApp — там, где уже живёт команда.",
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
        d: "Воронки, омниканальный чат, онлайн-запись, мультитенантный SaaS и KPI, которым можно доверять на управленческом уровне.",
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
    productsTitle: "Продукты",
    productsLead:
      "Живое портфолио продуктов, которые мы спроектировали, собрали и можем предоставить вам.",
    openDemo: "Войти в демо",
    openDemoInstant: "Открыть демо",
    viewAllDemos: "Все демо",
    statusLive: "Онлайн",
    statusStarting: "Запуск",
    statusDesktop: "Десктоп / закрытое",
    statusPrivate: "По запросу",
    statusShowcase: "Обзор",
    casesTitle: "Кейсы внедрений",
    casesLead:
      "Реальная операционная боль, что собрали и как иначе стал работать бизнес. Анонимно — для проверки, без выдуманных «+400%».",
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
        t: "Экспресс-знакомство (30 минут)",
        d: "Без долгих созвонов и скучных презентаций. Напрямую обсуждаем роли, фиксируем вводные и определяем оптимальный объём проекта. На выходе — понятный план действий и прямой путь к демо.",
      },
      {
        t: "Проектирование системы (5–10 дней)",
        d: "Создаём детальную «карту» будущего продукта. Вы получаете интерактивные экраны, проработанную модель данных и чёткие вехи разработки. Результат — полностью описанная логика системы у вас на руках.",
      },
      {
        t: "Запуск пилота (2–4 недели)",
        d: "Разворачиваем работающий прототип в реальной или тестовой среде. Мы не просто сдаём код, а обучаем вашу команду работе с ним и проводим совместный детальный разбор итогов.",
      },
    ],
    offerCta: "Заявка на экспресс-аудит",
    offerStripTitle: "Предложение в одну строку",
    offerStripLink: "Как это работает",
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
        t: "Готовность к проверке",
        d: "Билингвальный RU/EN рассказ, рыночные имена и публичный демо-хаб ускоряют проверку партнёрами и инвесторами.",
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
      "MetodiOne Studio — индивидуальное операционное ПО для бизнеса, команд и частных заказчиков. Демо на песочных данных, не на боевых системах клиентов.",
    demoDisclaimer: "Песочницы могут перезапускаться; данные сбрасываются.",
    copyLogin: "Копировать логин",
    copied: "Скопировано",
    backHome: "На главную студии",
    demosPageTitle: "Демо",
    demosVersionLabel: "Демо-версия",
    demosPageLead:
      "Откройте работающий продукт в один клик. Только тестовые данные — не боевые системы клиентов.",
    demosLiveTitle: "Можно открыть сейчас",
    demosLiveLead: "Вход без пароля в рабочие системы.",
    demosMoreLive: "Ещё демо",
    demosShowcaseTitle: "Обзоры",
    demosShowcaseLead: "Проход по интерфейсу, когда полная публичная песочница ещё не выведена.",
    demosOtherTitle: "По запросу",
    noPublicDemo: "Доступно по запросу",
    requestPrivate: "Запросить закрытое демо",
    openShowcase: "Открыть обзор",
    industriesTitle: "Отраслевые страницы",
    backStudio: "На главную студии",
    printPdf: "Печать / сохранить PDF",
    investorsTitle: "Для инвесторов",
    investorsLead:
      "MetodiOne Studio собирает и сопровождает индивидуальные операционные приложения — CRM, ERP, автоматизацию мессенджеров и HR — с живыми демо, которые можно проверить.",
    investorsWhatTitle: "Что такое студия",
    investorsWhat:
      "Продуктовая инженерная студия: диагностируем реальные процессы, выпускаем именные системы и держим песочницы для проверки. Бренд MetodiOne — про студию, а не разовый фриланс.",
    investorsLineTitle: "Линейка продуктов (рыночные имена)",
    investorsModelTitle: "Модель денег",
    investorsModelItems: [
      {
        t: "Проектная поставка",
        d: "Кастомные сборки по вехам — знакомство, MVP, запуск. Владение поставленным приложением у клиента, если не договорено иначе.",
      },
      {
        t: "Продуктивизированные вертикали",
        d: "Общее ремесло в рыночных продуктах (FuelOps, ScaleGate, StaffDesk…). Быстрый старт, когда домен совпадает с проверенным ядром.",
      },
      {
        t: "Сопровождение и итерации",
        d: "Хостинг, поддержка, обучение и доработки после запуска — регулярная выручка от систем в ежедневной эксплуатации.",
      },
    ],
    investorsRoadTitle: "План масштабирования",
    investorsRoadItems: [
      {
        t: "Сейчас",
        d: "Публичный сайт студии, билингвальный рассказ, демо-хаб, живые песочницы на Amvera, контроль аптайма, страница для инвесторов.",
      },
      {
        t: "Дальше",
        d: "Отдельные песочницы с изолированными демо-базами, веб-демо BakeFlow / Atelier / ClientOps, метрики кейсов по NDA.",
      },
      {
        t: "Затем",
        d: "Партнёрский канал по вертикалям, стандартизованные пакеты цен и капитальный рассказ на удержании боевых систем.",
      },
    ],
    showcaseRequest: "Запросить живую песочницу",
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
