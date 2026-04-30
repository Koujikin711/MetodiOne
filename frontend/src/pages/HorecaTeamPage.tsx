import { Link } from "react-router-dom";

export function HorecaTeamPage() {
  return (
    <div className="mx-auto max-w-[1100px] space-y-4 pb-10">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-teal-300/90">HoReCa / Команда</p>
        <h1 className="text-3xl font-semibold text-white">Роли и рабочие зоны персонала</h1>
        <p className="text-sm text-slate-400">Раздел с быстрыми входами по ролям и добавлением сотрудников.</p>
      </header>

      <section className="grid gap-3 md:grid-cols-2">
        <article className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
          <h2 className="text-base font-semibold text-white">Официанты</h2>
          <p className="mt-1 text-sm text-slate-300">Столики, заказы, коммуникация с кухней.</p>
          <Link to="/horeca/tables" className="mt-3 inline-flex rounded-lg border border-slate-600/60 px-3 py-1.5 text-xs text-slate-100">
            Открыть рабочую страницу
          </Link>
        </article>
        <article className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
          <h2 className="text-base font-semibold text-white">Кухня / повара</h2>
          <p className="mt-1 text-sm text-slate-300">Техкарты, заготовки, доступные порции и алерты по складу.</p>
          <div className="mt-3 flex gap-2">
            <Link to="/horeca/kitchen" className="inline-flex rounded-lg border border-slate-600/60 px-3 py-1.5 text-xs text-slate-100">
              Техкарты
            </Link>
            <Link to="/horeca/prep" className="inline-flex rounded-lg border border-slate-600/60 px-3 py-1.5 text-xs text-slate-100">
              Заготовки
            </Link>
          </div>
        </article>
        <article className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
          <h2 className="text-base font-semibold text-white">Администратор / менеджер</h2>
          <p className="mt-1 text-sm text-slate-300">Контроль смены, аналитика, производственная мощность.</p>
          <Link to="/horeca/forecast" className="mt-3 inline-flex rounded-lg border border-slate-600/60 px-3 py-1.5 text-xs text-slate-100">
            Прогнозирование
          </Link>
        </article>
        <article className="rounded-2xl border border-purple-500/30 bg-purple-950/15 p-4">
          <h2 className="text-base font-semibold text-white">Добавить сотрудников</h2>
          <p className="mt-1 text-sm text-slate-300">Создавайте официантов, поваров, кассиров и админов зала.</p>
          <Link to="/employees" className="mt-3 inline-flex rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white">
            Перейти в сотрудники
          </Link>
        </article>
      </section>
    </div>
  );
}
