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

const features = [
  "Объединение каналов продаж: WhatsApp, Telegram, звонки, формы и заявки",
  "Воронки и Kanban: создание этапов, контроль потока лидов, работа менеджеров",
  "Онлайн-запись: расписание экспертов, слоты и автоматическая привязка услуг",
  "KPI-матрица: план по количеству, факт по сумме, % выполнения по менеджеру",
  "Финансовый контур: ОПиУ, баланс, ОСВ, отчёты и экспорт в нужной валюте",
  "Аудит, роли, задачи и история действий для полной прозрачности процессов",
];

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

      <section className="mx-auto max-w-6xl px-4 pb-12 pt-10 sm:px-6 lg:px-8">
        <div className="grid items-start gap-8 lg:grid-cols-1">
          <div className="rounded-3xl border border-white/10 bg-slate-900/45 p-8 shadow-2xl shadow-black/25 sm:p-10">
            <p className="inline-flex rounded-full border border-fuchsia-300/30 bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-200">
              ERP для роста продаж
            </p>
            <h1 className="mt-4 max-w-4xl text-4xl font-bold leading-tight text-white sm:text-6xl">
              Увеличьте продажи и контроль команды в одной системе
            </h1>
            <p className="mt-5 max-w-4xl text-base text-slate-300 sm:text-lg">
              MetodiOne закрывает весь цикл: лиды, чат, онлайн-запись, задачи, KPI и финансы. Руководитель видит
              реальную картину по каждому менеджеру и услуге в реальном времени.
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
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
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
          <h2 className="text-3xl font-semibold sm:text-4xl">Наши преимущества</h2>
          <div className="mt-6 grid grid-cols-1 gap-4 text-sm text-slate-200 md:grid-cols-2 lg:grid-cols-3">
            {features.map((item) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-4">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
        <h2 className="text-3xl font-semibold sm:text-4xl">Как это работает</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5 shadow-lg shadow-black/15">
            <p className="text-xs font-semibold uppercase tracking-wide text-fuchsia-300">Шаг 1</p>
            <h3 className="mt-2 text-lg font-semibold">Подключаем каналы</h3>
            <p className="mt-2 text-sm text-slate-300">WhatsApp, Telegram, формы и источники лидов собираются в одном месте.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5 shadow-lg shadow-black/15">
            <p className="text-xs font-semibold uppercase tracking-wide text-fuchsia-300">Шаг 2</p>
            <h3 className="mt-2 text-lg font-semibold">Настраиваем воронки</h3>
            <p className="mt-2 text-sm text-slate-300">Добавляем этапы, роли, KPI и онлайн-запись под ваш процесс продаж.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5 shadow-lg shadow-black/15">
            <p className="text-xs font-semibold uppercase tracking-wide text-fuchsia-300">Шаг 3</p>
            <h3 className="mt-2 text-lg font-semibold">Запускаем и масштабируем</h3>
            <p className="mt-2 text-sm text-slate-300">Команда работает быстрее, а владелец видит цифры по выручке и эффективности.</p>
          </div>
        </div>
      </section>

      <section id="screens" className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
        <h2 className="mb-6 text-3xl font-semibold sm:text-4xl">Реальные скриншоты системы</h2>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {shots.map((item) => (
            <article key={item.src} className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40 shadow-lg shadow-black/20">
              <img src={item.src} alt={item.title} className="h-auto w-full object-cover" loading="lazy" />
              <div className="border-t border-white/10 px-4 py-3 text-sm text-slate-200">{item.title}</div>
            </article>
          ))}
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
