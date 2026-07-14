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
    navWork: "Work",
    navProducts: "Products",
    navDemos: "Demos",
    navContact: "Contact",
    ctaDemos: "Explore demos",
    ctaContact: "Discuss a build",
    ctaLogin: "CRM login",
    heroHeadline: "Software studio for operational systems that actually ship.",
    heroLead:
      "We design and build CRMs, ERPs, messenger bridges and automation — from first screen to production demo your team can click through.",
    whatTitle: "What we build",
    whatLead: "Product engineering for companies that sell, move, produce and serve — not slideware.",
    whatItems: [
      {
        t: "Industry ERPs",
        d: "Fuel trade, furniture production, confectionery, fashion retail, auto-parts warehouses.",
      },
      {
        t: "CRM & booking",
        d: "Pipelines, roles, omnichannel chat, online scheduling and KPI for service teams.",
      },
      {
        t: "Messenger automation",
        d: "WeChat / WhatsApp bridges, OCR from group photos, operator desks with installable clients.",
      },
    ],
    productsTitle: "Selected products",
    productsLead: "Market names for systems we’ve built and run. Open a demo when the sandbox is live.",
    openDemo: "Open demo",
    viewAllDemos: "All demos",
    statusLive: "Live demo",
    statusStarting: "Starting up",
    statusDesktop: "Desktop / private",
    statusPrivate: "On request",
    demosTitle: "Demo access",
    demosLead:
      "Sandbox environments with sample data — not client production. Use the hub to enter each product.",
    demosHubCta: "Enter demo hub",
    experienceTitle: "How we deliver",
    experienceItems: [
      {
        t: "Diagnose",
        d: "Map the real workflow: stages, stock, messengers, roles, where money and time leak.",
      },
      {
        t: "Build",
        d: "Ship a focused system in short cycles — web, desktop or WhatsApp automation as needed.",
      },
      {
        t: "Run",
        d: "Deploy, train the team, leave a demo you can reopen for the next stakeholder.",
      },
    ],
    contactTitle: "Ready to scope the next system?",
    contactLead: "Tell us the process. We’ll propose the product shape and a demo path.",
    contactName: "Name",
    contactCompany: "Company",
    contactEmail: "Email",
    contactPhone: "Phone",
    contactMessage: "What do you need?",
    contactSend: "Send request",
    contactSending: "Sending…",
    contactClose: "Close",
    footerNote: "MetodiOne Studio — product engineering for operational businesses.",
    demoDisclaimer: "Demo environments use sandbox data and may restart without notice.",
    copyLogin: "Copy login",
    copied: "Copied",
    backHome: "Back to studio",
    demosPageTitle: "Demo hub",
    demosPageLead: "Second door into MetodiOne products — pick a system and sign in with the demo account.",
    noPublicDemo: "No public URL yet — request a live walkthrough.",
    requestPrivate: "Request private demo",
  },
  ru: {
    brand: "MetodiOne",
    brandSub: "Studio",
    navWork: "Подход",
    navProducts: "Продукты",
    navDemos: "Демо",
    navContact: "Контакт",
    ctaDemos: "Смотреть демо",
    ctaContact: "Обсудить проект",
    ctaLogin: "Вход в CRM",
    heroHeadline: "Студия продуктов для операционных систем, которые реально работают.",
    heroLead:
      "Проектируем и собираем CRM, ERP, мосты к мессенджерам и автоматизацию — от первого экрана до демо, в которое можно кликнуть.",
    whatTitle: "Что делаем",
    whatLead: "Инженерия под компании, которые продают, возят, производят и обслуживают — не презентации.",
    whatItems: [
      {
        t: "Отраслевые ERP",
        d: "Топливо, мебель, кондитерка, fashion-retail, склады автозапчастей.",
      },
      {
        t: "CRM и запись",
        d: "Воронки, роли, омниканал-чат, онлайн-запись и KPI для сервисных команд.",
      },
      {
        t: "Автоматизация мессенджеров",
        d: "Мосты WeChat / WhatsApp, OCR с фото в группах, рабочие места операторов.",
      },
    ],
    productsTitle: "Продукты",
    productsLead: "Рыночные имена систем, которые мы собрали и сопровождаем. Демо — когда песочница жива.",
    openDemo: "Открыть демо",
    viewAllDemos: "Все демо",
    statusLive: "Live демо",
    statusStarting: "Запускается",
    statusDesktop: "Desktop / закрытое",
    statusPrivate: "По запросу",
    demosTitle: "Доступ к демо",
    demosLead:
      "Песочницы с тестовыми данными — не прод клиентов. Второй вход ко всем продуктам — в хабе демо.",
    demosHubCta: "Войти в демо-хаб",
    experienceTitle: "Как внедряем",
    experienceItems: [
      {
        t: "Диагностика",
        d: "Фиксируем реальный процесс: стадии, склад, мессенджеры, роли, где текут деньги и время.",
      },
      {
        t: "Сборка",
        d: "Короткими циклами выкатываем систему — web, desktop или WhatsApp-автоматизацию.",
      },
      {
        t: "Запуск",
        d: "Деплой, обучение команды и демо, которое можно снова показать стейкхолдерам.",
      },
    ],
    contactTitle: "Готовы обсудить следующую систему?",
    contactLead: "Опишите процесс — предложим форму продукта и путь к демо.",
    contactName: "Имя",
    contactCompany: "Компания",
    contactEmail: "Email",
    contactPhone: "Телефон",
    contactMessage: "Что нужно сделать?",
    contactSend: "Отправить",
    contactSending: "Отправка…",
    contactClose: "Закрыть",
    footerNote: "MetodiOne Studio — продуктовая инженерия для операционного бизнеса.",
    demoDisclaimer: "Демо на песочных данных; инстансы могут перезапускаться.",
    copyLogin: "Копировать логин",
    copied: "Скопировано",
    backHome: "На главную студии",
    demosPageTitle: "Демо-хаб",
    demosPageLead: "Второй вход в продукты MetodiOne — выберите систему и войдите демо-аккаунтом.",
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
