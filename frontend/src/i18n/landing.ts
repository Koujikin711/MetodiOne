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
    navAudience: "Who it's for",
    navWork: "What we build",
    navProducts: "Portfolio",
    navCases: "Cases",
    navDemos: "Demos",
    navEngage: "Engagement",
    navOffer: "How we work",
    navContact: "Contact",
    navInvestors: "Investors",
    ctaDemos: "Open demos",
    ctaContact: "Request a review",
    ctaLogin: "CRM login",
    ctaInvestors: "For investors",
    ctaOffer: "Request a review",
    heroHeadline: "Your process, built as software you can open today",
    heroPhrase1: "Your process",
    heroPhrase2: "built as software",
    heroPhrase3: "ready to open",
    heroLead:
      "We design and ship custom software for companies, teams and private clients — from focused tools to full ERP. A working test environment is ready on the day you contact us.",
    heroProofLive: "Live demos",
    heroProofLine: "FuelOps · ScaleGate · StaffDesk · MessageHub",
    heroProofCaption: "Open any product and walk the real interface.",
    audienceTitle: "For teams that need working systems",
    audienceLead:
      "We work with companies that have outgrown spreadsheets, founders launching a product, and owners who need software that follows their own process — not a generic template.",
    audienceItems: [
      {
        t: "Companies & holdings",
        d: "Industry workflows, roles, warehouse, finance and reporting in one product — instead of a pile of tools that fight each other every day.",
      },
      {
        t: "Growing teams & founders",
        d: "CRM, booking, messengers and KPIs around your funnel. The team can start using it within days.",
      },
      {
        t: "Specialists & private businesses",
        d: "Practical desks for bakeries, boutiques, workshops or a personal trade. The logic is written for your scenarios.",
      },
    ],
    customTitle: "Custom applications at any scale",
    customLead:
      "Every project starts from your process. You get software shaped around the people, documents and decisions that already exist in your organization.",
    customItems: [
      {
        t: "From a focused tool to a full stack",
        d: "WhatsApp automation, a warehouse desk, a multi-currency trading ERP or a multi-tenant CRM — we start with the smallest scope that moves the business, then expand without a rewrite.",
      },
      {
        t: "Web, desktop and messengers",
        d: "Browser apps, installable operator clients, OCR from photos, WeChat and WhatsApp bridges — wherever your teams already work.",
      },
      {
        t: "Systems you can show",
        d: "Clear product names, stable demos, roles and audit trails. Investors, partners and operators see the same running product.",
      },
    ],
    whatTitle: "What we build",
    whatLead:
      "Operational platforms for organizations that sell, manufacture, store, hire and serve — with the depth of a product studio.",
    whatItems: [
      {
        t: "Industry ERPs & warehouses",
        d: "Fuel wholesale, furniture production, confectionery, fashion retail, auto-parts stock, trading desks — documents, FIFO, posting, prints and roles.",
      },
      {
        t: "CRM, booking & customer ops",
        d: "Pipelines, omnichannel chat, online scheduling, multi-tenant setups and KPIs management can rely on.",
      },
      {
        t: "Automation & bridges",
        d: "WeChat and WhatsApp operator desks, weighbridge OCR from group photos, installable bridges, and HR alerts for visas, timesheets and payroll.",
      },
      {
        t: "Private & sensitive builds",
        d: "Closed client systems with controlled demos when the process cannot live on public SaaS.",
      },
    ],
    productsTitle: "Portfolio",
    productsLead: "Systems we designed, built and can deliver for you.",
    openDemo: "Open demo",
    openDemoInstant: "Open demo",
    viewAllDemos: "All demos",
    statusLive: "Live",
    statusStarting: "Starting",
    statusDesktop: "Desktop / private",
    statusPrivate: "On request",
    statusShowcase: "Preview",
    casesTitle: "Delivery cases",
    casesLead: "What hurt, what we shipped, and how operations changed. Client details are anonymized.",
    caseProblem: "The problem",
    caseDid: "What we did",
    caseResult: "Business impact",
    caseImpact: "What changed",
    casesShowMore: "Show all cases",
    casesShowLess: "Show less",
    casesMoreHint: "more",
    offerTitle: "How we work",
    offerLead: "From the first call to a system your team can use.",
    offerItems: [
      {
        t: "Discovery call (30 minutes)",
        d: "We map roles, inputs and scope. You leave with a clear plan and a path to a demo.",
      },
      {
        t: "System design (5–10 days)",
        d: "Interactive screens, a worked-out data model and milestones. You get a full description of the system logic.",
      },
      {
        t: "Pilot (2–4 weeks)",
        d: "A working build in a live or test environment, team training, and a joint review of results.",
      },
    ],
    offerCta: "Request a review",
    offerStripTitle: "How we work",
    offerStripLink: "Details",
    demosTitle: "Live demos",
    demosLead: "Open running products with sample data — the same interfaces operators use.",
    demosHubCta: "Go to demos",
    investTitle: "Why MetodiOne shows up in capital conversations",
    investLead:
      "We ship products that can be launched, demonstrated and operated — a line of vertical systems, not slide decks.",
    investItems: [
      {
        t: "Delivery you can verify",
        d: "Live demos across ERP, CRM, messengers and HR — clear proof of pace and domain range.",
      },
      {
        t: "Shared craft, unique products",
        d: "Common engineering standards with a product outcome: each client gets their own application.",
      },
      {
        t: "Ready for review",
        d: "RU/EN narrative, market product names and a public demo hub speed up partner and investor checks.",
      },
    ],
    contactTitle: "Tell us what should work better",
    contactLead:
      "Describe the business, the people involved and the outcome you need. We will propose format, timeline and a demo.",
    contactName: "Name",
    contactCompany: "Company / project",
    contactEmail: "Email",
    contactPhone: "Phone / WhatsApp",
    contactMessage: "Process, goals, constraints",
    contactSend: "Send request",
    contactSending: "Sending…",
    contactClose: "Close",
    footerNote:
      "MetodiOne Studio — custom operational software for businesses, teams and individuals.",
    demoDisclaimer: "",
    copyLogin: "Copy login",
    copied: "Copied",
    backHome: "Home",
    demosPageTitle: "Demos",
    demosVersionLabel: "",
    demosPageLead: "Open a running product. Each demo uses its own test data.",
    demosLiveTitle: "Available now",
    demosLiveLead: "Click through — no signup required.",
    demosMoreLive: "More products",
    demosShowcaseTitle: "Previews",
    demosShowcaseLead: "Interface walkthroughs while a full public demo is being prepared.",
    demosOtherTitle: "On request",
    noPublicDemo: "Available on request",
    requestPrivate: "Request a private demo",
    openShowcase: "Open preview",
    industriesTitle: "By industry",
    backStudio: "Home",
    printPdf: "Print / save PDF",
    investorsTitle: "For investors",
    investorsLead:
      "MetodiOne Studio designs, builds and supports custom operational applications — CRM, ERP, messenger automation and HR. Each product has a live demo you can open.",
    investorsWhatTitle: "What is MetodiOne Studio?",
    investorsWhat:
      "A product engineering studio. We map real business processes, ship custom systems under your brand, and keep test environments available for review.",
    investorsWhatNote: "",
    investorsLineTitle: "Product line",
    investorsModelTitle: "Engagement models",
    investorsModelItems: [
      {
        t: "Project delivery",
        d: "Phased build around your processes (discovery, MVP, launch). You own and run the application on your infrastructure.",
      },
      {
        t: "Industry solutions",
        d: "A fast start on proven cores such as FuelOps, ScaleGate or StaffDesk when your needs match an existing product.",
      },
      {
        t: "Support and development",
        d: "Technical support, training and post-launch reviews. Hosting stays on the client's servers; new features are delivered on request.",
      },
    ],
    investorsRoadTitle: "Roadmap",
    investorsRoadItems: [
      {
        t: "Now",
        items: [
          "Bilingual studio site and demo hub",
          "Interactive product demos",
          "Availability monitoring",
          "Investor section",
        ],
      },
      {
        t: "Next",
        items: [
          "More dedicated demo environments",
          "Web demos: BakeFlow, Atelier, ClientOps",
          "Case metrics under NDA",
        ],
      },
      {
        t: "Later",
        items: [
          "Partner network by industry",
          "Standard pricing packages",
          "Ongoing support for production systems",
        ],
      },
    ],
    showcaseRequest: "Request a live demo",
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
    navOffer: "Как работаем",
    navContact: "Контакт",
    navInvestors: "Инвесторам",
    ctaDemos: "Открыть демо",
    ctaContact: "Оставить заявку",
    ctaLogin: "Вход в CRM",
    ctaInvestors: "Инвесторам",
    ctaOffer: "Оставить заявку",
    heroHeadline: "Ваш процесс — в системе, которую можно открыть сегодня",
    heroPhrase1: "Ваш процесс",
    heroPhrase2: "в рабочей системе",
    heroPhrase3: "можно открыть сразу",
    heroLead:
      "Проектируем и внедряем кастомное ПО для компаний, команд и частных заказчиков — от точечных инструментов до полноценных ERP. Тестовая среда готова в день обращения.",
    heroProofLive: "Живые демо",
    heroProofLine: "FuelOps · ScaleGate · StaffDesk · MessageHub",
    heroProofCaption: "Откройте продукт и пройдите по реальному интерфейсу.",
    audienceTitle: "Для тех, кому нужны рабочие системы",
    audienceLead:
      "Работаем с компаниями, которые переросли таблицы, основателями на запуске продукта и владельцами, которым нужно ПО под свой процесс — без чужого шаблона.",
    audienceItems: [
      {
        t: "Компании и холдинги",
        d: "Отраслевые процессы, роли, склад, финансы и отчёты в одном продукте — вместо набора сервисов, которые мешают друг другу каждый день.",
      },
      {
        t: "Растущие команды и основатели",
        d: "CRM, запись, мессенджеры и KPI под вашу воронку. Команда начинает работу за несколько дней.",
      },
      {
        t: "Специалисты и частный бизнес",
        d: "Рабочие места для кондитерских, бутиков, мастерских или личного дела. Логика пишется под ваши сценарии.",
      },
    ],
    customTitle: "Индивидуальные приложения любого масштаба",
    customLead:
      "Каждый проект начинается с вашего процесса. Вы получаете ПО вокруг людей, документов и решений, которые уже есть в организации.",
    customItems: [
      {
        t: "От точечного инструмента до полного контура",
        d: "Автоматизация WhatsApp, склад, мультивалютная торговая ERP или мультитенант CRM — начинаем с того, что двигает бизнес, и расширяем без переписывания с нуля.",
      },
      {
        t: "Веб, десктоп и мессенджеры",
        d: "Браузерные приложения, клиенты для операторов, распознавание с фото, мосты WeChat и WhatsApp — там, где уже работает команда.",
      },
      {
        t: "Системы, которые можно показать",
        d: "Понятные имена продуктов, стабильные демо, роли и аудит. Инвестор, партнёр и операционный руководитель видят один и тот же работающий продукт.",
      },
    ],
    whatTitle: "Что мы создаём",
    whatLead:
      "Операционные платформы для организаций, которые продают, производят, хранят, нанимают и обслуживают — с глубиной продуктовой студии.",
    whatItems: [
      {
        t: "Отраслевые ERP и склады",
        d: "Опт топлива, мебельное производство, кондитерка, fashion-retail, автозапчасти, торговые столы — документы, FIFO, проведение, печать и роли.",
      },
      {
        t: "CRM, запись и клиентский контур",
        d: "Воронки, омниканальный чат, онлайн-запись, мультитенант и KPI, на которые можно опираться в управлении.",
      },
      {
        t: "Автоматизация и мосты",
        d: "Рабочие места WeChat и WhatsApp, OCR весов с фото из групп, устанавливаемые мосты, кадровые оповещения по визам, табелю и зарплате.",
      },
      {
        t: "Закрытые внедрения",
        d: "Клиентские системы с контролируемым доступом к демо, когда процесс нельзя выносить в публичный SaaS.",
      },
    ],
    productsTitle: "Портфолио",
    productsLead: "Системы, которые мы спроектировали, собрали и можем поставить вам.",
    openDemo: "Открыть демо",
    openDemoInstant: "Открыть демо",
    viewAllDemos: "Все демо",
    statusLive: "Онлайн",
    statusStarting: "Запуск",
    statusDesktop: "Десктоп / закрытое",
    statusPrivate: "По запросу",
    statusShowcase: "Обзор",
    casesTitle: "Кейсы внедрений",
    casesLead: "Что болело, что сделали и как изменилась работа. Детали клиентов обезличены.",
    caseProblem: "Проблема",
    caseDid: "Что сделали",
    caseResult: "Результат",
    caseImpact: "Что изменилось",
    casesShowMore: "Показать все кейсы",
    casesShowLess: "Свернуть",
    casesMoreHint: "ещё",
    offerTitle: "Как мы работаем",
    offerLead: "От первого звонка до системы, которой пользуется команда.",
    offerItems: [
      {
        t: "Знакомство (30 минут)",
        d: "Разбираем роли, вводные и объём. На выходе — план и путь к демо.",
      },
      {
        t: "Проектирование (5–10 дней)",
        d: "Экраны, модель данных и вехи. У вас на руках полное описание логики системы.",
      },
      {
        t: "Пилот (2–4 недели)",
        d: "Рабочая сборка в боевой или тестовой среде, обучение команды и совместный разбор результата.",
      },
    ],
    offerCta: "Оставить заявку",
    offerStripTitle: "Как мы работаем",
    offerStripLink: "Подробнее",
    demosTitle: "Живые демо",
    demosLead: "Откройте работающие продукты на тестовых данных — те же интерфейсы, что у операторов.",
    demosHubCta: "К демо",
    investTitle: "Почему MetodiOne подходит для разговора с инвестором",
    investLead:
      "Мы выпускаем продукты, которые можно запустить, показать и эксплуатировать — линейка вертикальных систем с живыми демо.",
    investItems: [
      {
        t: "Проверяемая поставка",
        d: "Живые демо по ERP, CRM, мессенджерам и HR — видна скорость и ширина доменов.",
      },
      {
        t: "Общее ремесло — свои продукты",
        d: "Единые инженерные стандарты и продуктовый результат: каждый заказчик получает своё приложение.",
      },
      {
        t: "Готовность к проверке",
        d: "RU/EN текст, рыночные имена продуктов и публичный демо-раздел ускоряют проверку партнёрами и инвесторами.",
      },
    ],
    contactTitle: "Расскажите, что должно работать лучше",
    contactLead:
      "Опишите бизнес, людей и нужный результат. Предложим формат, сроки и демо.",
    contactName: "Имя",
    contactCompany: "Компания / проект",
    contactEmail: "Email",
    contactPhone: "Телефон / WhatsApp",
    contactMessage: "Процесс, цели, ограничения",
    contactSend: "Отправить",
    contactSending: "Отправка…",
    contactClose: "Закрыть",
    footerNote:
      "MetodiOne Studio — индивидуальное операционное ПО для бизнеса, команд и частных заказчиков.",
    demoDisclaimer: "",
    copyLogin: "Копировать логин",
    copied: "Скопировано",
    backHome: "На главную",
    demosPageTitle: "Демо",
    demosVersionLabel: "",
    demosPageLead: "Откройте работающий продукт. У каждого демо — свои тестовые данные.",
    demosLiveTitle: "Доступны сейчас",
    demosLiveLead: "Открывайте сразу — регистрация не нужна.",
    demosMoreLive: "Другие продукты",
    demosShowcaseTitle: "Обзоры",
    demosShowcaseLead: "Разбор интерфейса, пока готовится полное публичное демо.",
    demosOtherTitle: "По запросу",
    noPublicDemo: "Доступно по запросу",
    requestPrivate: "Запросить закрытое демо",
    openShowcase: "Открыть обзор",
    industriesTitle: "По отраслям",
    backStudio: "На главную",
    printPdf: "Печать / сохранить PDF",
    investorsTitle: "Для инвесторов",
    investorsLead:
      "MetodiOne Studio проектирует, собирает и сопровождает индивидуальные операционные приложения — CRM, ERP, автоматизацию мессенджеров и HR. У каждого продукта есть живое демо.",
    investorsWhatTitle: "Что такое MetodiOne Studio?",
    investorsWhat:
      "Продуктовая инженерная студия. Разбираем реальные процессы, выпускаем системы под вашим брендом и держим тестовые среды для проверки.",
    investorsWhatNote: "",
    investorsLineTitle: "Линейка продуктов",
    investorsModelTitle: "Форматы сотрудничества",
    investorsModelItems: [
      {
        t: "Проектная поставка",
        d: "Поэтапная сборка под ваши процессы (знакомство, MVP, запуск). Владение и эксплуатация на инфраструктуре клиента.",
      },
      {
        t: "Отраслевые решения",
        d: "Быстрый старт на проверенных ядрах — FuelOps, ScaleGate, StaffDesk — если задачи совпадают с готовым продуктом.",
      },
      {
        t: "Сопровождение и развитие",
        d: "Поддержка, обучение и разбор сценариев после запуска. Хостинг на серверах клиента; новые функции — по запросу.",
      },
    ],
    investorsRoadTitle: "Дорожная карта",
    investorsRoadItems: [
      {
        t: "Сейчас",
        items: [
          "Двуязычный сайт студии и раздел демо",
          "Интерактивные демо продуктов",
          "Мониторинг доступности",
          "Раздел для инвесторов",
        ],
      },
      {
        t: "Дальше",
        items: [
          "Больше выделенных демо-сред",
          "Веб-демо: BakeFlow, Atelier, ClientOps",
          "Метрики кейсов под NDA",
        ],
      },
      {
        t: "Затем",
        items: [
          "Партнёрская сеть по отраслям",
          "Стандартные пакеты стоимости",
          "Сопровождение боевых систем",
        ],
      },
    ],
    showcaseRequest: "Запросить живое демо",
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
