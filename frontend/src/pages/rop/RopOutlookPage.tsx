import { useQuery } from "@tanstack/react-query";

import { RopPageIntro } from "@/components/RopPageIntro";
import { PrintMasthead } from "@/components/PrintMasthead";
import { apiFetch } from "@/lib/api";
import { useRopContext } from "@/pages/rop/RopLayout";

type Month = {
  year_month: string;
  label: string;
  leads: number;
  revenue: number | string;
  sold_count: number;
  full_paid_count: number;
  conversion_percent: number;
  leads_delta_pct?: number | null;
  revenue_delta_pct?: number | null;
  conversion_delta_pp?: number | null;
};

type Scenario = { key: string; label: string; leads: number; revenue: number | string };

type Outlook = {
  as_of: string;
  current: Month;
  previous: Month;
  scenarios: Scenario[];
  next_month?: Scenario | null;
  summary?: string;
};

function money(v: number | string | undefined) {
  return Number(v || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

function deltaText(v: number | null | undefined, unit = "%") {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}${unit}`;
}

function deltaClass(v: number | null | undefined) {
  if (v == null || v === 0) return "mo-muted";
  return v > 0 ? "rop-delta--up" : "rop-delta--down";
}

export function RopOutlookPage() {
  const { pipelineId } = useRopContext();

  const query = useQuery({
    queryKey: ["rop-outlook", pipelineId],
    enabled: pipelineId != null,
    refetchInterval: 60_000,
    queryFn: () => apiFetch<Outlook>(`/api/rop/outlook?pipeline_id=${pipelineId}`),
  });

  if (pipelineId == null) return <p className="text-sm mo-muted">Выберите воронку</p>;

  const data = query.data;
  const cur = data?.current;
  const prev = data?.previous;

  return (
    <div className="mo-print-doc flex flex-col gap-4">
      <PrintMasthead title="Прогноз отдела продаж" meta={data?.as_of ? `на ${data.as_of}` : undefined} />
      <RopPageIntro
        title="Прогноз"
        hint="Сравнение с прошлым месяцем и ориентир до конца месяца: худший / средний / лучший темп."
      />

      {query.isLoading ? <p className="text-sm mo-muted">Загрузка…</p> : null}
      {query.isError ? <p className="text-sm text-red-600">Не удалось загрузить прогноз</p> : null}

      {cur && prev ? (
        <>
          <section className="rop-outlook-compare" aria-label="Сравнение месяцев">
            <article className="rop-outlook-month">
              <h3 className="rop-outlook-month__label">{cur.label}</h3>
              <p className="rop-outlook-month__hint">текущий · по сегодня</p>
              <dl className="rop-outlook-month__metrics">
                <div>
                  <dt>Лиды</dt>
                  <dd>
                    {cur.leads.toLocaleString("ru-RU")}
                    <span className={deltaClass(cur.leads_delta_pct)}>{deltaText(cur.leads_delta_pct)}</span>
                  </dd>
                </div>
                <div>
                  <dt>Выручка</dt>
                  <dd>
                    {money(cur.revenue)}
                    <span className={deltaClass(cur.revenue_delta_pct)}>{deltaText(cur.revenue_delta_pct)}</span>
                  </dd>
                </div>
                <div>
                  <dt>Конверсия оплаты</dt>
                  <dd>
                    {cur.conversion_percent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%
                    <span className={deltaClass(cur.conversion_delta_pp)}>
                      {deltaText(cur.conversion_delta_pp, " п.п.")}
                    </span>
                  </dd>
                </div>
              </dl>
            </article>
            <article className="rop-outlook-month rop-outlook-month--prev">
              <h3 className="rop-outlook-month__label">{prev.label}</h3>
              <p className="rop-outlook-month__hint">прошлый · полный месяц</p>
              <dl className="rop-outlook-month__metrics">
                <div>
                  <dt>Лиды</dt>
                  <dd>{prev.leads.toLocaleString("ru-RU")}</dd>
                </div>
                <div>
                  <dt>Выручка</dt>
                  <dd>{money(prev.revenue)}</dd>
                </div>
                <div>
                  <dt>Конверсия оплаты</dt>
                  <dd>{prev.conversion_percent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%</dd>
                </div>
              </dl>
            </article>
          </section>

          <section className="rop-outlook-block" aria-label="Сценарии">
            <h3 className="rop-outlook-block__title">Если так пойдёт</h3>
            <p className="rop-outlook-block__hint">
              Темп по уже прошедшим дням: худший −15%, средний = текущий, лучший +15%.
            </p>
            <div className="rop-outlook-scenarios">
              {(data?.scenarios ?? []).map((s) => (
                <div key={s.key} className={`rop-outlook-scenario rop-outlook-scenario--${s.key}`}>
                  <span className="rop-outlook-scenario__label">{s.label}</span>
                  <strong className="rop-outlook-scenario__rev">{money(s.revenue)} с.</strong>
                  <span className="rop-outlook-scenario__leads">{s.leads.toLocaleString("ru-RU")} лидов</span>
                </div>
              ))}
            </div>
            {data?.next_month ? (
              <p className="rop-outlook-next text-sm mo-muted mt-3">
                След. месяц (средний темп):{" "}
                <strong className="text-[var(--mo-text)]">{money(data.next_month.revenue)} с.</strong>
                {" · "}
                {data.next_month.leads.toLocaleString("ru-RU")} лидов
              </p>
            ) : null}
          </section>

          {data?.summary ? <p className="rop-outlook-summary">{data.summary}</p> : null}
        </>
      ) : null}
    </div>
  );
}
