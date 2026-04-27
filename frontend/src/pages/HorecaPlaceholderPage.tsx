import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import {
  BarChart3,
  Calendar,
  CheckSquare,
  Funnel,
  MessageCircle,
  Plug,
  Target,
  UserRound,
  UtensilsCrossed,
  Wallet,
} from "@/components/icons";
import { useTariffNavAccess } from "@/hooks/useTariffNavAccess";
import { apiFetch, getActiveCompanyId, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { restaurantLexicon } from "@/lib/restaurantLexicon";
import type { HorecaOverviewRead } from "@/lib/types";

type HubCard = {
  feature: string | null;
  to: string;
  title: string;
  body: string;
  icon: ReactNode;
  soon?: boolean;
};

function CardShell({
  to,
  title,
  body,
  icon,
  soon,
  enabled,
}: {
  to: string;
  title: string;
  body: string;
  icon: ReactNode;
  soon?: boolean;
  enabled: boolean;
}) {
  const inner = (
    <div
      className={[
        "flex h-full flex-col gap-2 rounded-2xl border p-4 transition-colors",
        enabled
          ? "border-slate-600/50 bg-slate-900/40 hover:border-teal-500/40 hover:bg-slate-900/70"
          : "cursor-not-allowed border-slate-800/60 bg-slate-950/30 opacity-50",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-500/15 text-teal-200">{icon}</div>
        {soon ? (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-100">
            скоро
          </span>
        ) : null}
      </div>
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <p className="text-sm leading-relaxed text-slate-400">{body}</p>
    </div>
  );

  if (!enabled) {
    return <div className="h-full">{inner}</div>;
  }
  if (soon) {
    return <div className="h-full">{inner}</div>;
  }
  return (
    <Link to={to} className="block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60">
      {inner}
    </Link>
  );
}

const moneyFmt = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

function formatMoney(s: string) {
  const n = Number(s);
  return Number.isFinite(n) ? moneyFmt.format(n) : s;
}

function abcBadgeClass(klass: string) {
  if (klass === "A") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
  if (klass === "B") return "border-sky-500/40 bg-sky-500/10 text-sky-100";
  return "border-slate-500/40 bg-slate-500/10 text-slate-200";
}

function riskLabel(risk: string) {
  if (risk === "out") return "Нет остатка";
  if (risk === "low") return "Мало";
  return "Ок";
}

/** Центр HoReCa: смена, ABC меню, food-cost и быстрый доступ к модулям тарифа. */
export function HorecaPlaceholderPage() {
  const { showNavForFeature, restaurantMode } = useTariffNavAccess();
  const lex = restaurantLexicon(restaurantMode);

  const token = getStoredToken();
  const role = decodeRoleFromToken(token);
  const activeCid = getActiveCompanyId();
  const canLoadHorecaOverview =
    Boolean(token) &&
    (role !== "super_owner" || activeCid != null);

  const overviewQuery = useQuery({
    queryKey: ["horeca-overview", activeCid, role],
    queryFn: () => apiFetch<HorecaOverviewRead>("/api/horeca/overview"),
    enabled: canLoadHorecaOverview,
    staleTime: 30_000,
  });

  const cards: HubCard[] = [
    {
      feature: "crm",
      to: "/crm",
      title: lex.navKanbanTitle,
      body: "Зал и очередь заказов: от брони до «счёт оплачен» — без потерянных столиков и хаоса на пике.",
      icon: <Funnel className="h-5 w-5" />,
    },
    {
      feature: "crm",
      to: "/my-leads",
      title: lex.navGuestsTitle,
      body: "Постоянные гости, аллергии, предпочтения и история визитов — основа сервиса и повторных продаж.",
      icon: <UserRound className="h-5 w-5" />,
    },
    {
      feature: "booking",
      to: "/booking",
      title: "Бронь и предзаказ",
      body: "Снижайте no-show: напоминания, слоты, депозиты. Связка с залом и кухней — в одном контуре.",
      icon: <Calendar className="h-5 w-5" />,
    },
    {
      feature: "finance",
      to: "/finance",
      title: lex.navFinanceTitle,
      body: "Склад, списания, food cost и касса по сменам. Маржа по точке продаж, а не абстрактные «лиды».",
      icon: <Wallet className="h-5 w-5" />,
    },
    {
      feature: "kpi",
      to: "/kpi",
      title: lex.navKpiTitle,
      body: "Выручка на смену, средний чек, скорость обслуживания — KPI, которые владелец реально смотрит каждый день.",
      icon: <Target className="h-5 w-5" />,
    },
    {
      feature: "analytics",
      to: "/analytics",
      title: lex.navAnalyticsTitle,
      body: "Каналы привлечения гостей, загрузка зала и дебиторка по направлениям — те же отчёты, ресторанная подача.",
      icon: <BarChart3 className="h-5 w-5" />,
    },
    {
      feature: "tasks",
      to: "/tasks",
      title: "Задачи смены",
      body: "Открытие/закрытие, инвентаризация, чек-листы HACCP — чтобы ничего не уехало в чатах.",
      icon: <CheckSquare className="h-5 w-5" />,
    },
    {
      feature: "chat",
      to: "/chat",
      title: "Связь зал ↔ кухня",
      body: "Оперативные уточнения по блюдам и столам без «телефона трубку» на линии.",
      icon: <MessageCircle className="h-5 w-5" />,
    },
    {
      feature: "integrations",
      to: "/integrations",
      title: "Доставка и агрегаторы",
      body: "Подключение каналов (Яндекс, Wolt, собственная доставка) — единая картина заказов.",
      icon: <Plug className="h-5 w-5" />,
    },
    {
      feature: "horeca",
      to: "/horeca",
      title: "Кухня и техкарты",
      body: "Нормы закладки, списания по продажам, полуфабрикаты — следующий этап интеграции с вашим финблоком.",
      icon: <UtensilsCrossed className="h-5 w-5" />,
      soon: true,
    },
  ];

  const ov = overviewQuery.data;

  return (
    <div className="relative mx-auto max-w-5xl space-y-8 pb-12 pt-2">
      <header className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-widest text-teal-300/90">HoReCa</p>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Центр управления заведением</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-slate-400">
          Мы закрываем типичные боли: просадка маржи из-за списаний, непрозрачный склад, разрозненные брони и доставка,
          слабая дисциплина смены. Ниже — модули вашего тарифа; недоступные блоки можно добавить в{" "}
          <Link to="/billing" className="text-teal-200 underline hover:text-white">
            оплате и тарифе
          </Link>
          .
        </p>
      </header>

      <section className="rounded-2xl border border-teal-500/30 bg-teal-950/20 px-4 py-4">
        <p className="text-sm font-medium text-teal-100">Сегодня в продукте</p>
        <p className="mt-1 text-sm text-slate-300">
          Полноценный учёт и зал уже здесь; производственные карты, автосписание по POS и отдельный экран кухни — в
          разработке. API: <code className="text-slate-200">GET /api/horeca/ping</code>,{" "}
          <code className="text-slate-200">GET /api/horeca/overview</code>.
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Смена сейчас</h2>
            <p className="text-xs text-slate-400">
              Снимок по броням/записям за сегодня, открытым задачам и складу. Для точного food cost подключайте POS и
              техкарты — это следующий шаг.
            </p>
          </div>
          {overviewQuery.isFetching ? <span className="text-xs text-slate-500">обновление…</span> : null}
        </div>
        {!canLoadHorecaOverview ? (
          <p className="text-sm text-slate-400">
            Блок «Смена сейчас» и ABC по данным компании недоступны без контекста компании. Супер-владелец: откройте{" "}
            <Link to="/companies" className="text-teal-200 underline hover:text-white">
              Компании
            </Link>{" "}
            и нажмите «Войти в компанию».
          </p>
        ) : null}
        {overviewQuery.isError ? (
          <p className="text-sm text-red-300">{(overviewQuery.error as Error).message}</p>
        ) : null}
        {canLoadHorecaOverview && overviewQuery.isLoading ? <p className="text-sm text-slate-400">Загрузка KPI…</p> : null}
        {ov ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Записей сегодня</p>
              <p className="mt-1 text-2xl font-semibold text-white">{ov.shift.bookings_today}</p>
              <p className="mt-1 text-xs text-slate-400">По модулям онлайн-записи (как прокси заказов/визитов).</p>
            </div>
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Оплачено сегодня</p>
              <p className="mt-1 text-2xl font-semibold text-white">{formatMoney(ov.shift.revenue_today)}</p>
              <p className="mt-1 text-xs text-slate-400">Сумма оплат по записям за календарный день.</p>
            </div>
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Средний чек</p>
              <p className="mt-1 text-2xl font-semibold text-white">{formatMoney(ov.shift.avg_check_today)}</p>
              <p className="mt-1 text-xs text-slate-400">Если записей нет — 0.</p>
            </div>
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Открытые задачи</p>
              <p className="mt-1 text-2xl font-semibold text-white">{ov.shift.open_tasks}</p>
              <p className="mt-1 text-xs text-slate-400">Контроль смены: что «висит» и может сорвать сервис.</p>
            </div>
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Списания 7 дней (оценка)</p>
              <p className="mt-1 text-2xl font-semibold text-white">{formatMoney(ov.shift.cogs_7d)}</p>
              <p className="mt-1 text-xs text-slate-400">Складские списания × себестоимость партии (FIFO/avg).</p>
            </div>
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Риск по складу</p>
              <p className="mt-1 text-2xl font-semibold text-white">{ov.shift.low_stock_items}</p>
              <p className="mt-1 text-xs text-slate-400">Позиций с нулём или микроостатком по топ-20 запасов.</p>
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-white">ABC меню (30 дней)</h2>
              <p className="text-xs text-slate-400">
                Кумулятивная доля выручки по позициям из поля «услуга» в записях. A — до 80%, B — до 95%, остальное C.
              </p>
            </div>
          </div>
          {ov && ov.abc_menu.length === 0 ? (
            <p className="text-sm text-slate-400">Пока нет оплаченных записей с названием позиции — заполните услугу в брони.</p>
          ) : null}
          {ov && ov.abc_menu.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm text-slate-200">
                <thead className="text-slate-400">
                  <tr>
                    <th className="py-2 pr-3">Позиция</th>
                    <th className="py-2 pr-3">Класс</th>
                    <th className="py-2 pr-3">Доля</th>
                    <th className="py-2 pr-3">Выручка</th>
                  </tr>
                </thead>
                <tbody>
                  {ov.abc_menu.map((r) => (
                    <tr key={r.item_name} className="border-t border-slate-800">
                      <td className="py-2 pr-3">{r.item_name}</td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${abcBadgeClass(r.abc_class)}`}>{r.abc_class}</span>
                      </td>
                      <td className="py-2 pr-3">{r.share_pct}%</td>
                      <td className="py-2 pr-3">{formatMoney(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4">
          <div className="mb-3">
            <h2 className="text-lg font-semibold text-white">Food cost / склад</h2>
            <p className="text-xs text-slate-400">
              Топ запасов по стоимости остатка. Низкий остаток подсвечивается — типичная боль «закончилось на пике».
            </p>
          </div>
          {ov && ov.food_cost_top.length === 0 ? (
            <p className="text-sm text-slate-400">Нет складских остатков — заведите продукты и приходы в финансах.</p>
          ) : null}
          {ov && ov.food_cost_top.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm text-slate-200">
                <thead className="text-slate-400">
                  <tr>
                    <th className="py-2 pr-3">Продукт</th>
                    <th className="py-2 pr-3">Остаток</th>
                    <th className="py-2 pr-3">Себестоимость</th>
                    <th className="py-2 pr-3">Стоимость</th>
                    <th className="py-2 pr-3">Доля</th>
                    <th className="py-2 pr-3">Риск</th>
                  </tr>
                </thead>
                <tbody>
                  {ov.food_cost_top.map((r) => (
                    <tr key={r.product_id} className="border-t border-slate-800">
                      <td className="py-2 pr-3">{r.product_name}</td>
                      <td className="py-2 pr-3">{r.quantity}</td>
                      <td className="py-2 pr-3">{formatMoney(r.avg_unit_cost)}</td>
                      <td className="py-2 pr-3">{formatMoney(r.stock_value)}</td>
                      <td className="py-2 pr-3">{r.share_pct}%</td>
                      <td className="py-2 pr-3">{riskLabel(r.risk)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {showNavForFeature("finance") ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to="/finance"
                className="rounded-xl border border-teal-600/50 bg-teal-950/30 px-3 py-2 text-xs font-medium text-teal-50 hover:bg-teal-950/50"
              >
                Открыть финансы и склад
              </Link>
            </div>
          ) : null}
        </section>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-white">Модули</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <CardShell
              key={`${c.to}-${c.title}`}
              to={c.to}
              title={c.title}
              body={c.body}
              icon={c.icon}
              soon={c.soon}
              enabled={c.feature == null || showNavForFeature(c.feature)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
