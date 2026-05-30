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
import type { HorecaFinanceSummaryRead, HorecaOverviewRead } from "@/lib/types";

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
          ? "border-[#d8d2c6] bg-white hover:border-[#2f5f85]/40 hover:shadow-md"
          : "cursor-not-allowed border-[#e2dcd0] bg-[#f3efe6]/50 opacity-50",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#e8f0f7] text-[#2f5f85]">{icon}</div>
        {soon ? (
          <span className="rounded-full border border-[#c9b07a]/50 bg-[#faf5eb] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#8a6d2e]">
            скоро
          </span>
        ) : null}
      </div>
      <h2 className="text-base font-semibold text-[#1e3348]">{title}</h2>
      <p className="text-sm leading-relaxed text-[#5c6b7a]">{body}</p>
    </div>
  );

  if (!enabled) {
    return <div className="h-full">{inner}</div>;
  }
  if (soon) {
    return <div className="h-full">{inner}</div>;
  }
  return (
    <Link to={to} className="block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2f5f85]/50">
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
  if (klass === "A") return "border-[#2d6a5a]/40 bg-[#edf7f1] text-[#2d6a5a]";
  if (klass === "B") return "border-[#2f5f85]/40 bg-[#e8f0f7] text-[#2f5f85]";
  return "border-[#d8d2c6] bg-[#f3efe6] text-[#5c6b7a]";
}

function riskLabel(risk: string) {
  if (risk === "out") return "Нет остатка";
  if (risk === "low") return "Мало";
  return "Ок";
}

/** Центр HoReCa: смена, ABC меню, food-cost и быстрый доступ к модулям тарифа. */
export function HorecaPlaceholderPage() {
  const { showNavForFeature } = useTariffNavAccess();

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
  const financeSummaryQuery = useQuery({
    queryKey: ["horeca-finance-summary", activeCid, role],
    queryFn: () => apiFetch<HorecaFinanceSummaryRead>("/api/horeca/finance/summary?days=30"),
    enabled: canLoadHorecaOverview,
    staleTime: 60_000,
  });

  const cards: HubCard[] = [
    {
      feature: "horeca",
      to: "/horeca/tables",
      title: "Зал и посадка",
      body: "Столы, брони, статусы, скорость обслуживания и контроль загрузки зала в одном контуре.",
      icon: <Funnel className="h-5 w-5" />,
    },
    {
      feature: "horeca",
      to: "/horeca/orders",
      title: "Заказы и стадии",
      body: "Отдельная доска заказов по стадиям смены: новые, в работе, готово и закрытые.",
      icon: <UtensilsCrossed className="h-5 w-5" />,
    },
    {
      feature: "horeca",
      to: "/horeca/guests",
      title: "База гостей",
      body: "История визитов, предпочтения, аллергии, VIP-статусы и повторные продажи без CRM-шума.",
      icon: <UserRound className="h-5 w-5" />,
    },
    {
      feature: "horeca",
      to: "/horeca/kitchen",
      title: "Кухня и техкарты",
      body: "Техкарты, нормы закладки, себестоимость порции и контроль отклонений по ингредиентам.",
      icon: <Calendar className="h-5 w-5" />,
    },
    {
      feature: "horeca",
      to: "/horeca/stock",
      title: "Склад и списания",
      body: "Остатки, приход/расход, стоп-лист и списания, чтобы не было «закончились продукты на пике».",
      icon: <Wallet className="h-5 w-5" />,
    },
    {
      feature: "horeca",
      to: "/horeca/finance",
      title: "Финансы HoReCa",
      body: "Выручка, COGS, food cost, валовая прибыль и маржа в ресторанной логике, а не в CRM-метриках.",
      icon: <Target className="h-5 w-5" />,
    },
    {
      feature: "horeca",
      to: "/horeca/analytics",
      title: "Аналитика HoReCa",
      body: "ABC-меню, средний чек, оборачиваемость столов, загрузка смен и эффективность команды.",
      icon: <BarChart3 className="h-5 w-5" />,
    },
    {
      feature: "horeca",
      to: "/horeca/shift-tasks",
      title: "Задачи смены",
      body: "Открытие/закрытие, инвентаризация, чек-листы HACCP — чтобы ничего не уехало в чатах.",
      icon: <CheckSquare className="h-5 w-5" />,
    },
    {
      feature: "horeca",
      to: "/horeca/comms",
      title: "Связь зал ↔ кухня",
      body: "Оперативные уточнения по блюдам и столам без «телефона трубку» на линии.",
      icon: <MessageCircle className="h-5 w-5" />,
    },
    {
      feature: "horeca",
      to: "/horeca/delivery",
      title: "Доставка и агрегаторы",
      body: "Подключение каналов (Яндекс, Wolt, собственная доставка) — единая картина заказов.",
      icon: <Plug className="h-5 w-5" />,
    },
    {
      feature: "horeca",
      to: "/horeca/prep",
      title: "Заготовки повара",
      body: "Фиксация заготовок по блюдам и расчёт доступных к продаже порций на текущую смену.",
      icon: <CheckSquare className="h-5 w-5" />,
    },
    {
      feature: "horeca",
      to: "/horeca/forecast",
      title: "Прогноз мощности",
      body: "Оценка максимальной производительности ресторана по столам, команде и длительности визитов.",
      icon: <BarChart3 className="h-5 w-5" />,
    },
    {
      feature: "horeca",
      to: "/horeca/team",
      title: "Роли и команда",
      body: "Ролевые рабочие зоны (официанты, кухня, админ) и быстрый доступ к добавлению сотрудников.",
      icon: <UserRound className="h-5 w-5" />,
    },
  ];

  const ov = overviewQuery.data;
  const fin = financeSummaryQuery.data;

  return (
    <div className="relative mx-auto max-w-5xl space-y-8 pb-12 pt-2">
      <header className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-widest text-[#2f5f85]">HoReCa</p>
        <h1 className="text-3xl font-semibold tracking-tight text-[#1e3348]">Центр управления заведением</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-[#5c6b7a]">
          Мы закрываем типичные боли: просадка маржи из-за списаний, непрозрачный склад, разрозненные брони и доставка,
          слабая дисциплина смены. Ниже — внутренняя структура отдельного HoReCa-модуля. Доступ управляется одной
          тарифной функцией <code className="text-[#2f5f85]">horeca</code>.
        </p>
        <p className="max-w-3xl text-sm leading-relaxed text-[#5c6b7a]">
          Для коммерции и лимитов тарифов переходите в{" "}
          <Link to="/billing" className="mo-link font-medium">
            оплате и тарифе
          </Link>
          .
        </p>
      </header>

      <section className="mo-section border-[#2f5f85]/25 bg-[#e8f0f7]/50">
        <p className="text-sm font-medium text-[#2f5f85]">Сегодня в продукте</p>
        <p className="mt-1 text-sm text-[#5c6b7a]">
          Полноценный учёт и зал уже здесь; производственные карты, автосписание по POS и отдельный экран кухни — в
          разработке. API: <code className="text-[#1e3348]">GET /api/horeca/ping</code>,{" "}
          <code className="text-[#1e3348]">GET /api/horeca/overview</code>.
        </p>
      </section>

      <section className="mo-section space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#1e3348]">Смена сейчас</h2>
            <p className="text-xs text-[#5c6b7a]">
              Снимок по броням/записям за сегодня, открытым задачам и складу. Для точного food cost подключайте POS и
              техкарты — это следующий шаг.
            </p>
          </div>
          {overviewQuery.isFetching ? <span className="text-xs text-[#8a96a3]">обновление…</span> : null}
        </div>
        {!canLoadHorecaOverview ? (
          <p className="text-sm text-[#5c6b7a]">
            Блок «Смена сейчас» и ABC по данным компании недоступны без контекста компании. Супер-владелец: откройте{" "}
            <Link to="/companies" className="mo-link font-medium">
              Компании
            </Link>{" "}
            и нажмите «Войти в компанию».
          </p>
        ) : null}
        {overviewQuery.isError ? (
          <p className="text-sm text-[#9b3d3d]">{(overviewQuery.error as Error).message}</p>
        ) : null}
        {canLoadHorecaOverview && overviewQuery.isLoading ? <p className="text-sm text-[#5c6b7a]">Загрузка KPI…</p> : null}
        {ov ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="mo-kpi">
              <p className="mo-kpi-label">Записей сегодня</p>
              <p className="mo-kpi-value">{ov.shift.bookings_today}</p>
              <p className="mt-1 text-xs text-[#5c6b7a]">По модулям онлайн-записи (как прокси заказов/визитов).</p>
            </div>
            <div className="mo-kpi">
              <p className="mo-kpi-label">Оплачено сегодня</p>
              <p className="mo-kpi-value">{formatMoney(ov.shift.revenue_today)}</p>
              <p className="mt-1 text-xs text-[#5c6b7a]">Сумма оплат по записям за календарный день.</p>
            </div>
            <div className="mo-kpi">
              <p className="mo-kpi-label">Средний чек</p>
              <p className="mo-kpi-value">{formatMoney(ov.shift.avg_check_today)}</p>
              <p className="mt-1 text-xs text-[#5c6b7a]">Если записей нет — 0.</p>
            </div>
            <div className="mo-kpi">
              <p className="mo-kpi-label">Открытые задачи</p>
              <p className="mo-kpi-value">{ov.shift.open_tasks}</p>
              <p className="mt-1 text-xs text-[#5c6b7a]">Контроль смены: что «висит» и может сорвать сервис.</p>
            </div>
            <div className="mo-kpi">
              <p className="mo-kpi-label">Списания 7 дней (оценка)</p>
              <p className="mo-kpi-value">{formatMoney(ov.shift.cogs_7d)}</p>
              <p className="mt-1 text-xs text-[#5c6b7a]">Складские списания × себестоимость партии (FIFO/avg).</p>
            </div>
            <div className="mo-kpi">
              <p className="mo-kpi-label">Риск по складу</p>
              <p className="mo-kpi-value">{ov.shift.low_stock_items}</p>
              <p className="mt-1 text-xs text-[#5c6b7a]">Позиций с нулём или микроостатком по топ-20 запасов.</p>
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="mo-section">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-[#1e3348]">ABC меню (30 дней)</h2>
              <p className="text-xs text-[#5c6b7a]">
                Кумулятивная доля выручки по позициям из поля «услуга» в записях. A — до 80%, B — до 95%, остальное C.
              </p>
            </div>
          </div>
          {ov && ov.abc_menu.length === 0 ? (
            <p className="text-sm text-[#5c6b7a]">Пока нет оплаченных записей с названием позиции — заполните услугу в брони.</p>
          ) : null}
          {ov && ov.abc_menu.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="mo-table min-w-[520px]">
                <thead>
                  <tr>
                    <th className="py-2 pr-3">Позиция</th>
                    <th className="py-2 pr-3">Класс</th>
                    <th className="py-2 pr-3">Доля</th>
                    <th className="py-2 pr-3">Выручка</th>
                  </tr>
                </thead>
                <tbody>
                  {ov.abc_menu.map((r) => (
                    <tr key={r.item_name}>
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

        <section className="mo-section">
          <div className="mb-3">
            <h2 className="text-lg font-semibold text-[#1e3348]">Food cost / склад</h2>
            <p className="text-xs text-[#5c6b7a]">
              Топ запасов по стоимости остатка. Низкий остаток подсвечивается — типичная боль «закончилось на пике».
            </p>
          </div>
          {ov && ov.food_cost_top.length === 0 ? (
            <p className="text-sm text-[#5c6b7a]">Нет складских остатков — заведите продукты и приходы в финансах.</p>
          ) : null}
          {ov && ov.food_cost_top.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="mo-table min-w-[560px]">
                <thead>
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
                    <tr key={r.product_id}>
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
          <div className="mt-3 rounded-xl border border-[#d8d2c6] bg-[#faf8f4] px-3 py-2 text-xs text-[#5c6b7a]">
            Это данные отдельного HoReCa-контура. Общие CRM-разделы здесь не используются.
          </div>
        </section>
      </div>

      <section className="mo-section space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#1e3348]">Финансы HoReCa (30 дней)</h2>
            <p className="text-xs text-[#5c6b7a]">
              Ресторанный финконтур: выручка, COGS, food cost и валовая маржа по позициям меню. COGS рассчитывается по
              техкартам и средним складским ценам.
            </p>
          </div>
          {financeSummaryQuery.isFetching ? <span className="text-xs text-[#8a96a3]">обновление…</span> : null}
        </div>
        {!canLoadHorecaOverview ? (
          <p className="text-sm text-[#5c6b7a]">Финансы HoReCa доступны в контексте выбранной компании.</p>
        ) : null}
        {financeSummaryQuery.isError ? (
          <p className="text-sm text-[#9b3d3d]">{(financeSummaryQuery.error as Error).message}</p>
        ) : null}
        {canLoadHorecaOverview && financeSummaryQuery.isLoading ? (
          <p className="text-sm text-[#5c6b7a]">Загрузка ресторанных финансов…</p>
        ) : null}
        {fin ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="mo-kpi">
                <p className="mo-kpi-label">Выручка</p>
                <p className="mo-kpi-value">{formatMoney(fin.revenue)}</p>
              </div>
              <div className="mo-kpi">
                <p className="mo-kpi-label">COGS</p>
                <p className="mo-kpi-value">{formatMoney(fin.cogs)}</p>
              </div>
              <div className="mo-kpi">
                <p className="mo-kpi-label">Валовая маржа</p>
                <p className="mo-kpi-value">{formatMoney(fin.gross_profit)}</p>
                <p className="mt-1 text-xs text-[#5c6b7a]">{fin.gross_margin_pct}%</p>
              </div>
              <div className="mo-kpi">
                <p className="mo-kpi-label">Food cost</p>
                <p className="mo-kpi-value">{fin.food_cost_pct}%</p>
                <p className="mt-1 text-xs text-[#5c6b7a]">
                  Продаж: {fin.sales_count}, без техкарт: {fin.unmapped_sales_count}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="mo-table min-w-[760px]">
                <thead>
                  <tr>
                    <th className="py-2 pr-3">Позиция</th>
                    <th className="py-2 pr-3">ABC</th>
                    <th className="py-2 pr-3">Кол-во</th>
                    <th className="py-2 pr-3">Выручка</th>
                    <th className="py-2 pr-3">COGS</th>
                    <th className="py-2 pr-3">Валовая прибыль</th>
                    <th className="py-2 pr-3">Food cost %</th>
                  </tr>
                </thead>
                <tbody>
                  {fin.items.map((r) => (
                    <tr key={r.menu_item_name}>
                      <td className="py-2 pr-3">
                        {r.menu_item_name}
                        {r.unmapped ? <span className="ml-2 text-xs text-[#8a6d2e]">нет техкарты</span> : null}
                      </td>
                      <td className="py-2 pr-3">{r.abc_class}</td>
                      <td className="py-2 pr-3">{r.qty}</td>
                      <td className="py-2 pr-3">{formatMoney(r.revenue)}</td>
                      <td className="py-2 pr-3">{formatMoney(r.cogs)}</td>
                      <td className="py-2 pr-3">{formatMoney(r.gross_profit)}</td>
                      <td className="py-2 pr-3">{r.food_cost_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-[#1e3348]">Модули</h2>
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
