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
    navDemos: "Live demos",
    navEngage: "Engagement",
    navContact: "Contact",
    ctaDemos: "Explore live demos",
    ctaContact: "Start a conversation",
    ctaLogin: "CRM login",
    heroHeadline: "Custom operational software — engineered for the way you actually work.",
    heroLead:
      "MetodiOne Studio designs and ships individual applications of any complexity: for companies, teams, and personal businesses. From a focused tool to a full ERP — built to run, not to pitch.",
    audienceTitle: "Built for decision-makers who need systems, not slides",
    audienceLead:
      "We partner with businesses that outgrew spreadsheets, founders who need a product-shaped operations core, and individuals who want a reliable system around their craft.",
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
    openDemo: "Open demo",
    viewAllDemos: "Open demo hub",
    statusLive: "Live demo",
    statusStarting: "Starting up",
    statusDesktop: "Desktop / private",
    statusPrivate: "On request",
    demosTitle: "Proof you can click — live sandbox demos",
    demosLead:
      "Investors and partners should not rely on mockups. Enter a second door into running environments with sample data. Credentials are published in the hub for self-serve walkthroughs.",
    demosHubCta: "Enter the demo hub",
    experienceTitle: "How an engagement works",
    experienceItems: [
      {
        t: "Discover",
        d: "We map roles, documents, exceptions and future growth. Outcome: a clear product brief and architecture options — not a vague “digital transformation” deck.",
      },
      {
        t: "Design & build",
        d: "Short cycles with a working UI early. You see flows, data model and integrations as they mature. Scope stays tied to business value.",
      },
      {
        t: "Deploy & evidence",
        d: "Production or sandbox hosts, training and a reopenable demo for the next stakeholder meeting — board, investor or operations lead.",
      },
    ],
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
  },
  ru: {
    brand: "MetodiOne",
    brandSub: "Studio",
    navAudience: "Для кого",
    navWork: "Что создаём",
    navProducts: "Портфолио",
    navDemos: "Живые демо",
    navEngage: "Как работаем",
    navContact: "Контакт",
    ctaDemos: "Смотреть живые демо",
    ctaContact: "Начать разговор",
    ctaLogin: "Вход в CRM",
    heroHeadline: "Индивидуальное операционное ПО — под то, как вы реально работаете.",
    heroLead:
      "MetodiOne Studio проектирует и выпускает приложения любой сложности: для компаний, команд и личного бизнеса. От точечного инструмента до полноценной ERP — чтобы пользоваться, а не «презентовать».",
    audienceTitle: "Для тех, кому нужны рабочие системы, а не слайды",
    audienceLead:
      "Мы работаем с бизнесом, который вырос из Excel; с основателями, которым нужен операционный каркас продукта; и с частными заказчиками, которым нужна надёжная система вокруг своего дела.",
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
    openDemo: "Открыть демо",
    viewAllDemos: "Открыть демо-хаб",
    statusLive: "Live демо",
    statusStarting: "Запускается",
    statusDesktop: "Desktop / закрытое",
    statusPrivate: "По запросу",
    demosTitle: "Доказательство кликом — живые песочницы",
    demosLead:
      "Инвесторам и партнёрам не нужны макеты. Второй вход — в работающие среды с тестовыми данными. Логины опубликованы в хабе для самостоятельного прохождения.",
    demosHubCta: "Войти в демо-хаб",
    experienceTitle: "Как устроено сотрудничество",
    experienceItems: [
      {
        t: "Исследование",
        d: "Фиксируем роли, документы, исключения и рост. На выходе — бриф и варианты архитектуры, а не размытая «цифровая трансформация».",
      },
      {
        t: "Дизайн и сборка",
        d: "Короткие циклы с рабочим интерфейсом рано. Вы видите потоки, модель данных и интеграции по мере зрелости. Объём привязан к бизнес-эффекту.",
      },
      {
        t: "Деплой и доказательства",
        d: "Прод или песочница, обучение и демо, которое можно снова открыть на совете, у инвестора или операционного директора.",
      },
    ],
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
  },
} as const;

export type LandingCopy = (typeof dict)["en"];

export function landingCopy(lang: LandingLang): LandingCopy {
  return dict[lang] as LandingCopy;
}

export function statusLabel(lang: LandingLang, status: "live" | "starting" | "desktop" | "private"): string {
  const t = landingCopy(lang);
  if (status === "live") return t.statusLive;
  if (status === "starting") return t.statusStarting;
  if (status === "desktop") return t.statusDesktop;
  return t.statusPrivate;
}
