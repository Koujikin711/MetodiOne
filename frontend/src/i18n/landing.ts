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
    heroHeadline: "Your process — a working system — proof in a click",
    heroPhrase1: "Your process",
    heroPhrase2: "a working system",
    heroPhrase3: "proof in a click",
    heroLead:
      "We build custom IT solutions for businesses, teams and private clients — from microservices to large-scale ERP. We spin up a test sandbox the day you reach out.",
    heroProofLive: "Live demos",
    heroProofLine: "FuelOps · ScaleGate · StaffDesk · MessageHub",
    heroProofCaption: "Market product names. Real interfaces. Separate demo databases.",
    audienceTitle: "Built for decision-makers who need systems, not slides",
    audienceLead:
      "We work with businesses that outgrew Excel spreadsheets, founders launching a product, and entrepreneurs who need a reliable system around their own processes. No forcing your work into someone else’s box — every project is built around your real logic.",
    audienceItems: [
      {
        t: "Companies & holdings",
        d: "Industry processes, roles, warehouse, finance and reports — one coherent product instead of a zoo of third-party tools that constantly clash in day-to-day operations.",
      },
      {
        t: "Growing teams & founders",
        d: "CRM, booking, messengers and KPI tied to your funnel — a working product the team picks up in a couple of days, not after months of expensive, useless “consulting”.",
      },
      {
        t: "Specialists & private businesses",
        d: "Practical desks for bakeries, boutiques, workshops or your personal trade. Logic is written for you — not rented as a template that breaks on the first non-standard scenario.",
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
    openDemo: "Launch demo",
    openDemoInstant: "Launch demo",
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
      "We build products that can be launched, shown and operated. That is what sets a studio with a line of ready vertical systems apart from a services firm that only sells promises.",
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
      "Describe the business, the people involved and the outcome you need — an internal system, a product for customers, or a personal workflow. We will propose format, timeline and a demo path.",
    contactName: "Name",
    contactCompany: "Company / project",
    contactEmail: "Email",
    contactPhone: "Phone / WhatsApp",
    contactMessage: "Process, goals, constraints",
    contactSend: "Send request",
    contactSending: "Sending…",
    contactClose: "Close",
    footerNote:
      "MetodiOne Studio — custom operational software for businesses, teams and individuals. Demo versions run on test data and are fully isolated from client production systems.",
    demoDisclaimer:
      "Please note: sandboxes restart periodically, and any data you enter is reset.",
    copyLogin: "Copy login",
    copied: "Copied",
    backHome: "Back to studio",
    demosPageTitle: "MetodiOne demo hub",
    demosVersionLabel: "",
    demosPageLead:
      "Open a running product in one click. All demos run exclusively on test data and are isolated from client production systems.",
    demosLiveTitle: "Available right now",
    demosLiveLead: "Entry into working systems is passwordless.",
    demosMoreLive: "Other sandboxes",
    demosShowcaseTitle: "Product previews",
    demosShowcaseLead:
      "Interactive interface walkthroughs for solutions whose full public sandbox is still being prepared.",
    demosOtherTitle: "On request",
    demosBackHome: "← MetodiOne home",
    noPublicDemo: "Available on request",
    requestPrivate: "Request private demo",
    openShowcase: "Read preview",
    industriesTitle: "Industry pages",
    backStudio: "Studio home",
    printPdf: "Print / save PDF",
    investorsTitle: "For investors",
    investorsLead:
      "MetodiOne Studio designs, builds and supports individual operational applications (CRM, ERP, messenger automation and HR systems). Every product has a live demo you can verify in real time.",
    investorsWhatTitle: "What is MetodiOne Studio?",
    investorsWhat:
      "We are a product engineering studio. We diagnose real business processes, ship custom systems under your brand, and deploy isolated sandboxes for testing.",
    investorsWhatNote: "MetodiOne is a systematic studio approach — not one-off freelance work.",
    investorsLineTitle: "Product line (market cases)",
    investorsModelTitle: "Engagement formats",
    investorsModelItems: [
      {
        t: "Project delivery",
        d: "Phased build around your business processes (discovery, MVP, launch). Ownership and operation of the configured application on the client’s infrastructure.",
      },
      {
        t: "Ready-made industry solutions",
        d: "Fast start on our proven products (FuelOps, ScaleGate, StaffDesk). Ideal when your business needs match an existing system core.",
      },
      {
        t: "Support and development",
        d: "Technical support, team training, and post-launch usage reviews. Deployment runs on the client’s servers; new features and changes are delivered on individual request.",
      },
    ],
    investorsRoadTitle: "Development roadmap",
    investorsRoadItems: [
      {
        t: "Now",
        items: [
          "Bilingual studio site and demo hub",
          "Interactive sandboxes (demo stands)",
          "Availability and uptime monitoring",
          "Investor section",
        ],
      },
      {
        t: "Next",
        items: [
          "Dedicated sandboxes with isolated databases",
          "Web demos: BakeFlow, Atelier, ClientOps",
          "Real case metrics (under NDA)",
        ],
      },
      {
        t: "Then",
        items: [
          "Partner network across industry verticals",
          "Standardized pricing packages",
          "Support and maintenance for production systems",
        ],
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
    heroHeadline: "Ваш процесс — рабочая система — доказательство в клик",
    heroPhrase1: "Ваш процесс",
    heroPhrase2: "рабочая система",
    heroPhrase3: "доказательство в клик",
    heroLead:
      "Разрабатываем кастомные IT-решения для бизнеса, команд и частных заказчиков — от микросервисов до масштабных ERP. Тестовую песочницу разворачиваем в день обращения.",
    heroProofLive: "Живые демо",
    heroProofLine: "FuelOps · ScaleGate · StaffDesk · MessageHub",
    heroProofCaption: "Рыночные имена продуктов. Реальные интерфейсы. Отдельные демо-базы.",
    audienceTitle: "Для тех, кому нужны рабочие системы, а не слайды",
    audienceLead:
      "Мы работаем с бизнесом, который перерос таблицы Excel, основателями на этапе запуска продукта и предпринимателями, которым нужна надёжная система под их собственные процессы. Никаких попыток натянуть вашу работу на чужую коробку — каждый проект мы строим вокруг вашей реальной логики.",
    audienceItems: [
      {
        t: "Компании и холдинги",
        d: "Отраслевые процессы, роли, склад, финансы и отчёты — один цельный продукт вместо «зоопарка» сторонних сервисов, которые постоянно конфликтуют друг с другом в реальных операциях.",
      },
      {
        t: "Растущие команды и основатели",
        d: "CRM, запись, мессенджеры и KPI под вашу воронку — работающий продукт, который команда осваивает за пару дней, а не после месяцев дорогого и бесполезного «консалтинга».",
      },
      {
        t: "Специалисты и частный бизнес",
        d: "Удобные рабочие места для кондитерских, бутиков, мастерских или вашего личного дела. Логика пишется под вас, а не арендуется в виде шаблона, который ломается при первом же нестандартном сценарии.",
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
    openDemo: "Запустить демо",
    openDemoInstant: "Запустить демо",
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
      "Мы делаем продукты, которые можно запустить, показать и эксплуатировать. В этом отличие студии с линейкой готовых вертикальных систем от сервиса, который продаёт только обещания.",
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
      "Опишите бизнес, людей и нужный результат — внутреннюю систему, продукт для клиентов или личный процесс. Предложим формат, сроки и путь к демо.",
    contactName: "Имя",
    contactCompany: "Компания / проект",
    contactEmail: "Email",
    contactPhone: "Телефон / WhatsApp",
    contactMessage: "Процесс, цели, ограничения",
    contactSend: "Отправить",
    contactSending: "Отправка…",
    contactClose: "Закрыть",
    footerNote:
      "MetodiOne Studio — индивидуальное операционное ПО для бизнеса, команд и частных заказчиков. Демо-версии работают на тестовых данных и полностью изолированы от боевых систем клиентов.",
    demoDisclaimer:
      "Обратите внимание: песочницы периодически перезапускаются, а внесенные данные сбрасываются.",
    copyLogin: "Копировать логин",
    copied: "Скопировано",
    backHome: "На главную студии",
    demosPageTitle: "Демо-хаб MetodiOne",
    demosVersionLabel: "",
    demosPageLead:
      "Откройте работающий продукт в один клик. Все демо-версии работают исключительно на тестовых данных и изолированы от боевых систем клиентов.",
    demosLiveTitle: "Доступны прямо сейчас",
    demosLiveLead: "Вход в рабочие системы осуществляется без пароля.",
    demosMoreLive: "Другие песочницы",
    demosShowcaseTitle: "Обзоры продуктов",
    demosShowcaseLead:
      "Интерактивный разбор интерфейсов для решений, полнофункциональная публичная песочница которых ещё находится в процессе подготовки.",
    demosOtherTitle: "По запросу",
    demosBackHome: "← На главную MetodiOne",
    noPublicDemo: "Доступно по запросу",
    requestPrivate: "Запросить закрытое демо",
    openShowcase: "Читать обзор",
    industriesTitle: "Отраслевые страницы",
    backStudio: "На главную студии",
    printPdf: "Печать / сохранить PDF",
    investorsTitle: "Для инвесторов",
    investorsLead:
      "MetodiOne Studio проектирует, собирает и сопровождает индивидуальные операционные приложения (CRM, ERP, автоматизацию мессенджеров и HR-системы). Все продукты имеют живые демо-версии, работу которых можно проверить в реальном времени.",
    investorsWhatTitle: "Что такое MetodiOne Studio?",
    investorsWhat:
      "Мы — продуктовая инженерная студия. Мы диагностируем реальные бизнес-процессы, выпускаем кастомные системы под вашим брендом и разворачиваем изолированные песочницы для их тестирования.",
    investorsWhatNote: "MetodiOne — это системный подход технологической студии, а не разовый фриланс.",
    investorsLineTitle: "Линейка продуктов (рыночные кейсы)",
    investorsModelTitle: "Форматы сотрудничества",
    investorsModelItems: [
      {
        t: "Проектная поставка",
        d: "Поэтапная сборка под ваши бизнес-процессы (знакомство, MVP, запуск). Владение и использование настроенного приложения на мощностях клиента.",
      },
      {
        t: "Готовые отраслевые решения",
        d: "Быстрый запуск на базе наших проверенных продуктов (FuelOps, ScaleGate, StaffDesk). Идеально, если ваши бизнес-задачи совпадают с готовым ядром системы.",
      },
      {
        t: "Сопровождение и развитие",
        d: "Техническая поддержка, обучение вашей команды и разбор сценариев использования после запуска. Развёртывание осуществляется на серверах клиента, а любые новые функции и доработки реализуются по индивидуальному запросу.",
      },
    ],
    investorsRoadTitle: "Дорожная карта развития",
    investorsRoadItems: [
      {
        t: "Сейчас",
        items: [
          "Двуязычный сайт студии и демо-хаб",
          "Интерактивные песочницы (демо-стенды)",
          "Мониторинг доступности и аптайма",
          "Раздел для инвесторов",
        ],
      },
      {
        t: "Дальше",
        items: [
          "Выделенные песочницы с изолированными базами",
          "Веб-демо: BakeFlow, Atelier, ClientOps",
          "Реальные метрики кейсов (под NDA)",
        ],
      },
      {
        t: "Затем",
        items: [
          "Партнёрская сеть по отраслевым вертикалям",
          "Стандартизированные тарифные пакеты",
          "Сопровождение и поддержка боевых систем",
        ],
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
