import { FormEvent, useState } from "react";
import { toast } from "react-hot-toast";

import { apiFetch } from "@/lib/api";

const shots = [
  { src: "/landing/01-finance-charts.png", title: "Финансовые графики" },
  { src: "/landing/02-kpi-matrix.png", title: "KPI по услугам и менеджерам" },
  { src: "/landing/03-lead-card.png", title: "Карточка клиента" },
  { src: "/landing/04-chat.png", title: "Чат с клиентами" },
  { src: "/landing/05-finance-tables.png", title: "ОПиУ и ОСВ таблицы" },
  { src: "/landing/06-finance-overview.png", title: "Финансовый обзор" },
  { src: "/landing/07-booking.png", title: "Онлайн-запись" },
  { src: "/landing/08-integrations.png", title: "Интеграции и каналы" },
  { src: "/landing/09-tasks.png", title: "Командные задачи" },
  { src: "/landing/10-analytics-detail.png", title: "Детальная аналитика" },
  { src: "/landing/11-analytics-funnel.png", title: "Аналитика по воронкам" },
  { src: "/landing/12-crm-settings.png", title: "Настройки воронки" },
  { src: "/landing/13-crm-board.png", title: "Kanban-доска" },
];

const platformTabs = [
  {
    id: "crm",
    title: "CRM и воронки",
    lead: "Контроль лидов от первого контакта до закрытия сделки.",
    bullets: [
      "Kanban-доска по стадиям с приоритетом диалогов, где клиент ждёт ответ",
      "Карточка лида: история действий, задачи, коммуникации, суммы и статусы",
      "Гибкая настройка воронок, источников, стадий и ответственных",
      "Роли owner/admin/manager/expert и ограничения доступа по направлениям",
    ],
  },
  {
    id: "chat",
    title: "Чаты и коммуникации",
    lead: "Единая работа с клиентскими сообщениями и быстрые ответы.",
    bullets: [
      "Чаты WhatsApp/Telegram/Instagram в одном интерфейсе",
      "Непрочитанные входящие, сортировка по ожидающим ответа",
      "Отправка текста, файлов, голосовых; история сохраняется в CRM",
      "Уведомления о новых сообщениях и смене статусов задач",
    ],
  },
  {
    id: "booking",
    title: "Онлайн-запись",
    lead: "Запись клиентов на услуги без хаоса в расписании.",
    bullets: [
      "Календарь специалистов, слоты, переносы и быстрая запись",
      "Привязка записи к лиду и автоматическая смена стадии",
      "Учет направлений, длительности услуг и загрузки команды",
      "Форма новой записи с контролем воронки и ответственных",
    ],
  },
  {
    id: "finance",
    title: "KPI и финансы",
    lead: "Руководитель видит план, факт и маржинальность в реальном времени.",
    bullets: [
      "KPI по менеджерам и услугам: план/факт/% выполнения",
      "Финансовые отчёты: ОПиУ, баланс, ОСВ, детализация по периодам",
      "Контроль сумм сделок, допродаж и закрытия менеджерами",
      "Экспорт и прозрачная аналитика для управленческих решений",
    ],
  },
  {
    id: "integrations",
    title: "Интеграции",
    lead: "Подключайте каналы и данные без переписывания процессов.",
    bullets: [
      "Green API (WhatsApp), Telegram Bot, Instagram/Meta webhook",
      "Google Sheets синхронизация лидов в CRM",
      "Gmail-подключение через app password и IMAP",
      "Панель интеграций с подсказками, секретами и проверкой настроек",
    ],
  },
] as const;

const targetGroups = [
  {
    title: "Малый бизнес",
    text: "Салоны, сервис, клиники и небольшие отделы продаж, которым нужен порядок без сложного внедрения.",
  },
  {
    title: "Средний бизнес",
    text: "Компании с несколькими менеджерами и направлениями, где важно масштабировать воронки и контроль KPI.",
  },
  {
    title: "Крупный бизнес",
    text: "Сети и холдинги, которым нужны роли, интеграции, прозрачная аналитика и единый стандарт работы.",
  },
];

const quickStats = [
  { value: "5+", label: "основных модулей в одной системе" },
  { value: "1", label: "единый контур для лидов, чатов, записи и финансов" },
  { value: "24/7", label: "прозрачность работы команды и воронок" },
  { value: "0", label: "лишних сервисов для базового процесса продаж" },
];

const integrationBadges = [
  "WhatsApp",
  "Telegram",
  "Instagram",
  "Gmail",
  "Google Sheets",
  "KPI",
  "Финансы",
  "Онлайн-запись",
  "Kanban",
  "Аудит",
];

type BillingCycle = "monthly" | "yearly";

const pricingPlans = [
  {
    id: "standard",
    name: "Стандарт",
    monthlyPrice: 450,
    users: "до 3 пользователей",
    extraUserPrice: 40,
    features: ["Kanban", "1 канал интеграции"],
  },
  {
    id: "standard_plus",
    name: "Стандарт+",
    monthlyPrice: 800,
    users: "до 5 пользователей",
    extraUserPrice: 40,
    features: ["Kanban", "1 канал интеграции", "KPI", "Задачи"],
  },
  {
    id: "premium",
    name: "Премиум",
    monthlyPrice: 1100,
    users: "до 6 пользователей",
    extraUserPrice: 30,
    features: ["Kanban", "2 канала интеграции", "KPI", "Задачи", "Аналитика"],
  },
  {
    id: "premium_plus",
    name: "Премиум+",
    monthlyPrice: 2000,
    users: "до 10 пользователей",
    extraUserPrice: 30,
    recommended: true,
    features: ["Kanban", "3 канала интеграции", "KPI", "Задачи", "Аналитика"],
  },
  {
    id: "vip",
    name: "VIP",
    monthlyPrice: 4500,
    users: "до 15 пользователей",
    extraUserPrice: 20,
    features: ["Kanban", "4 канала интеграции", "KPI", "Задачи", "Аналитика", "Финансы (без склада и ОПиУ)"],
  },
  {
    id: "vip_plus",
    name: "VIP+",
    monthlyPrice: 6000,
    users: "до 25 пользователей",
    extraUserPrice: 20,
    features: ["Kanban", "5 каналов интеграции", "KPI", "Задачи", "Аналитика", "Финансы (включая склад и ОПиУ)"],
  },
] as const;

function formatSomoni(value: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(value)} сомони`;
}

const faq = [
  {
    q: "Для чего нужна MetodiOne ERP?",
    a: "Чтобы объединить продажи, запись, коммуникации и финансы в одной системе и повысить управляемость команды.",
  },
  {
    q: "Кто может использовать систему?",
    a: "Владельцы, админы, менеджеры и эксперты. Для каждой роли доступен свой уровень прав и инструментов.",
  },
  {
    q: "Можно ли настроить ERP под мой бизнес?",
    a: "Да. Настраиваются воронки, стадии, источники лидов, роли, интеграции и отчеты под вашу структуру работы.",
  },
  {
    q: "Как быстро запустить?",
    a: "Базовый запуск занимает 1-2 дня: подключение каналов, настройка воронок, обучение команды и старт работы.",
  },
];

export function LandingPage() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [openFaq, setOpenFaq] = useState<number>(0);
  const [demoOpen, setDemoOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<(typeof platformTabs)[number]["id"]>("crm");
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const activePlatform = platformTabs.find((item) => item.id === activeTab) ?? platformTabs[0];

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      await apiFetch("/api/system/demo-request", {
        method: "POST",
        body: JSON.stringify({
          full_name: fullName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          message: message.trim() || null,
        }),
      });
      toast.success("Заявка отправлена. Мы свяжемся с вами в ближайшее время.");
      setFullName("");
      setPhone("");
      setEmail("");
      setMessage("");
      setDemoOpen(false);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Ошибка отправки заявки";
      toast.error(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(1200px_700px_at_10%_-10%,rgba(168,85,247,0.28),transparent_62%),radial-gradient(1200px_740px_at_90%_0%,rgba(59,130,246,0.26),transparent_60%),#090f22] text-slate-100">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-gradient-to-br from-fuchsia-500 to-indigo-500 px-2 py-1 text-xs font-bold text-white">
              M1
            </div>
            <span className="text-sm font-semibold sm:text-base">MetodiOne ERP</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
            <a href="#features" className="transition hover:text-fuchsia-300">
              Возможности
            </a>
            <a href="#solutions" className="transition hover:text-fuchsia-300">
              Для кого
            </a>
            <a href="#pricing" className="transition hover:text-fuchsia-300">
              Тарифы
            </a>
            <a href="#screens" className="transition hover:text-fuchsia-300">
              Скриншоты
            </a>
            <a href="#faq" className="transition hover:text-fuchsia-300">
              FAQ
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDemoOpen(true)}
              className="rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-fuchsia-900/35 transition hover:opacity-95"
            >
              Получить демо
            </button>
            <a
              href="/login"
              className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
            >
              Вход
            </a>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-10 pt-10 sm:px-6 lg:px-8">
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-3xl border border-white/10 bg-slate-900/45 p-8 shadow-2xl shadow-black/25 sm:p-10">
            <p className="inline-flex rounded-full border border-fuchsia-300/30 bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-200">
              Единая ERP-платформа
            </p>
            <h1 className="mt-4 max-w-4xl text-4xl font-bold leading-tight text-white sm:text-6xl">
              MetodiOne помогает бизнесу работать быстрее и прозрачнее
            </h1>
            <p className="mt-5 max-w-4xl text-base text-slate-300 sm:text-lg">
              Вместо десятка сервисов — один рабочий контур: CRM, чаты, онлайн-запись, KPI, задачи и финансовый
              контроль. Руководитель видит реальную ситуацию по команде и выручке в режиме реального времени.
            </p>
            <div className="mt-7 grid max-w-4xl gap-3 text-sm text-slate-200 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-300/20 bg-emerald-500/10 px-4 py-3">
                Рост скорости ответа и меньше потерь лидов
              </div>
              <div className="rounded-xl border border-sky-300/20 bg-sky-500/10 px-4 py-3">
                Контроль планов продаж по каждому менеджеру
              </div>
              <div className="rounded-xl border border-fuchsia-300/20 bg-fuchsia-500/10 px-4 py-3">
                Автоматизация от заявки до финансовой отчетности
              </div>
              <div className="rounded-xl border border-indigo-300/20 bg-indigo-500/10 px-4 py-3">
                Подходит для клиник, сервиса, продаж и сетевого бизнеса
              </div>
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setDemoOpen(true)}
                className="rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-900/35 transition hover:opacity-95"
              >
                Получить демо за 5 минут
              </button>
              <a
                href="#screens"
                className="rounded-xl border border-white/20 bg-white/5 px-5 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
              >
                Смотреть интерфейс
              </a>
            </div>
          </div>
          <aside className="rounded-3xl border border-white/10 bg-slate-900/45 p-6 shadow-2xl shadow-black/25">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-fuchsia-200">Ключевые показатели</h2>
            <div className="mt-4 space-y-3">
              {quickStats.map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3">
                  <div className="text-2xl font-bold text-white">{item.value}</div>
                  <div className="mt-1 text-xs text-slate-300">{item.label}</div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
          <p className="mb-3 text-xs uppercase tracking-wider text-slate-400">Платформа закрывает ключевые процессы</p>
          <div className="flex flex-wrap gap-2">
            {integrationBadges.map((item) => (
              <span key={item} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-slate-200">
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section id="solutions" className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          {targetGroups.map((item) => (
            <article key={item.title} className="rounded-2xl border border-white/10 bg-slate-900/40 p-5 shadow-lg shadow-black/15">
              <h3 className="text-xl font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6 shadow-lg shadow-black/20 sm:p-8">
          <h2 className="text-3xl font-semibold sm:text-4xl">Возможности MetodiOne</h2>
          <div className="mt-5 flex flex-wrap gap-2">
            {platformTabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={[
                  "rounded-xl border px-3 py-2 text-sm transition",
                  activeTab === item.id
                    ? "border-fuchsia-300/40 bg-fuchsia-500/20 text-white"
                    : "border-white/15 bg-slate-950/45 text-slate-300 hover:bg-white/10 hover:text-white",
                ].join(" ")}
              >
                {item.title}
              </button>
            ))}
          </div>
          <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/40 p-5">
            <h3 className="text-xl font-semibold text-white">{activePlatform.title}</h3>
            <p className="mt-2 text-sm text-slate-300">{activePlatform.lead}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {activePlatform.bullets.map((item) => (
                <div key={item} className="rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3 text-sm text-slate-200">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="screens" className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
        <h2 className="mb-2 text-3xl font-semibold sm:text-4xl">Интерфейс в работе</h2>
        <p className="mb-6 text-sm text-slate-300">
          Реальные экраны MetodiOne: CRM-доска, чат, KPI, финансы, задачи, онлайн-запись и интеграции.
        </p>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {shots.map((item) => (
            <article key={item.src} className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40 shadow-lg shadow-black/20">
              <img src={item.src} alt={item.title} className="h-auto w-full object-cover" loading="lazy" />
              <div className="border-t border-white/10 px-4 py-3 text-sm text-slate-200">{item.title}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-white/10 bg-gradient-to-r from-indigo-500/15 via-fuchsia-500/10 to-sky-500/15 p-7 shadow-lg shadow-black/20">
          <h2 className="text-3xl font-semibold sm:text-4xl">Запуск за короткий цикл</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-fuchsia-300">Этап 1</p>
              <h3 className="mt-2 text-lg font-semibold">Диагностика процесса</h3>
              <p className="mt-2 text-sm text-slate-300">Фиксируем текущую воронку, роли, каналы и точки потерь.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-fuchsia-300">Этап 2</p>
              <h3 className="mt-2 text-lg font-semibold">Настройка системы</h3>
              <p className="mt-2 text-sm text-slate-300">Подключаем интеграции, стадии, KPI и онлайн-запись под ваш процесс.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-fuchsia-300">Этап 3</p>
              <h3 className="mt-2 text-lg font-semibold">Запуск команды</h3>
              <p className="mt-2 text-sm text-slate-300">Обучаем сотрудников, запускаем контроль и стабилизируем метрики.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-white/10 bg-slate-900/45 p-6 shadow-lg shadow-black/20 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-3xl font-semibold sm:text-4xl">Тарифы</h2>
              <p className="mt-2 text-sm text-slate-300">
                Выберите формат оплаты: помесячно или на год со скидкой 15%.
              </p>
            </div>
            <div className="inline-flex rounded-xl border border-white/15 bg-slate-950/60 p-1 text-sm">
              <button
                type="button"
                onClick={() => setBillingCycle("monthly")}
                className={[
                  "rounded-lg px-3 py-1.5 transition",
                  billingCycle === "monthly" ? "bg-fuchsia-500/25 text-white" : "text-slate-300 hover:text-white",
                ].join(" ")}
              >
                Ежемесячная
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle("yearly")}
                className={[
                  "rounded-lg px-3 py-1.5 transition",
                  billingCycle === "yearly" ? "bg-fuchsia-500/25 text-white" : "text-slate-300 hover:text-white",
                ].join(" ")}
              >
                Годовая (−15%)
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pricingPlans.map((plan) => {
              const isYearly = billingCycle === "yearly";
              const monthlyDisplay = isYearly ? Math.round(plan.monthlyPrice * 0.85) : plan.monthlyPrice;
              const yearlyTotal = Math.round(plan.monthlyPrice * 12 * 0.85);
              return (
                <article
                  key={plan.id}
                  className={[
                    "rounded-2xl border p-5 shadow-lg shadow-black/20",
                    plan.recommended
                      ? "border-fuchsia-300/50 bg-fuchsia-500/10 ring-1 ring-fuchsia-300/35"
                      : "border-white/10 bg-slate-950/45",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xl font-semibold text-white">{plan.name}</h3>
                    {plan.recommended && (
                      <span className="rounded-full border border-fuchsia-300/40 bg-fuchsia-500/20 px-2 py-0.5 text-[11px] font-semibold text-fuchsia-100">
                        Рекомендуем
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-3xl font-bold text-white">{formatSomoni(monthlyDisplay)}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {isYearly ? "в месяц при оплате за год" : "в месяц"}
                  </p>
                  {isYearly && <p className="mt-1 text-xs text-emerald-300">Итого за год: {formatSomoni(yearlyTotal)}</p>}
                  <p className="mt-4 text-sm text-slate-200">{plan.users}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Доп. пользователь: +{formatSomoni(plan.extraUserPrice)} / мес
                  </p>
                  <ul className="mt-4 space-y-1.5 text-sm text-slate-200">
                    {plan.features.map((feature) => (
                      <li key={feature}>• {feature}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => setDemoOpen(true)}
                    className="mt-5 w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-fuchsia-900/35 transition hover:opacity-95"
                  >
                    Выбрать тариф
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-4xl px-4 pb-16 sm:px-6 lg:px-8">
        <h2 className="mb-6 text-center text-3xl font-semibold sm:text-4xl">Часто задаваемые вопросы</h2>
        <div className="space-y-3">
          {faq.map((item, idx) => {
            const open = openFaq === idx;
            return (
              <article key={item.q} className="rounded-2xl border border-white/10 bg-slate-900/40 shadow-lg shadow-black/15">
                <button
                  type="button"
                  onClick={() => setOpenFaq(open ? -1 : idx)}
                  className="flex w-full items-center justify-between px-5 py-4 text-left"
                >
                  <span className="text-sm font-semibold sm:text-base">{item.q}</span>
                  <span className="text-xl leading-none text-fuchsia-300">{open ? "−" : "+"}</span>
                </button>
                {open && <p className="border-t border-white/10 px-5 py-4 text-sm leading-relaxed text-slate-300">{item.a}</p>}
              </article>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-fuchsia-300/20 bg-slate-900/45 p-8 text-center shadow-2xl shadow-black/25 sm:p-10">
          <h2 className="text-3xl font-semibold text-white sm:text-4xl">Готовы собрать всю операционку в одной ERP?</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-300 sm:text-base">
            Покажем, как именно MetodiOne ляжет на ваш процесс продаж и обслуживания клиентов — без лишних модулей и
            сложного внедрения.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setDemoOpen(true)}
              className="rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-fuchsia-900/35 transition hover:opacity-95"
            >
              Получить демо
            </button>
            <a
              href="/login"
              className="rounded-xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
            >
              Перейти в систему
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-slate-900 py-10 text-slate-200">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:grid-cols-2 sm:px-6 lg:px-8">
          <div>
            <h3 className="text-lg font-semibold">MetodiOne ERP</h3>
            <p className="mt-2 text-sm text-slate-400">
              ERP-платформа для продаж, коммуникаций, KPI и финансового контроля.
            </p>
          </div>
          <div className="text-sm sm:text-right">
            <p>Email: metoditj@gmail.com</p>
            <p className="mt-1 text-slate-400">© {new Date().getFullYear()} MetodiOne. Все права защищены.</p>
          </div>
        </div>
      </footer>

      {demoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4">
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl shadow-black/50">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold text-white">Запросить демо</h2>
                <p className="mt-1 text-sm text-slate-300">Оставьте контакты, и мы отправим вам персональную демонстрацию продукта.</p>
              </div>
              <button
                type="button"
                onClick={() => setDemoOpen(false)}
                className="rounded-lg border border-white/20 px-3 py-1 text-sm text-slate-200 transition hover:bg-white/10"
              >
                Закрыть
              </button>
            </div>
            <form onSubmit={onSubmit} className="space-y-3">
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                minLength={2}
                placeholder="ФИО"
                className="w-full rounded-xl border border-white/15 bg-slate-950/60 px-4 py-2.5 text-sm text-slate-100 outline-none ring-fuchsia-400/40 transition focus:ring-2"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                minLength={7}
                placeholder="Телефон"
                className="w-full rounded-xl border border-white/15 bg-slate-950/60 px-4 py-2.5 text-sm text-slate-100 outline-none ring-fuchsia-400/40 transition focus:ring-2"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="Email"
                className="w-full rounded-xl border border-white/15 bg-slate-950/60 px-4 py-2.5 text-sm text-slate-100 outline-none ring-fuchsia-400/40 transition focus:ring-2"
              />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder="Комментарий (необязательно)"
                className="w-full resize-none rounded-xl border border-white/15 bg-slate-950/60 px-4 py-2.5 text-sm text-slate-100 outline-none ring-fuchsia-400/40 transition focus:ring-2"
              />
              <button
                type="submit"
                disabled={sending}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-900/35 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {sending ? "Отправка..." : "Отправить заявку"}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
