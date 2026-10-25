import { useMemo } from "react";

import { readAds, type ForecastCampaign, type ForecastDay } from "@/lib/marketingForecast";

type Props = {
  daily: ForecastDay[];
  campaigns: ForecastCampaign[];
  accountSpend: number;
  accountLeads: number;
  periodEnd: string;
  currency: string;
};

const CHIP: Record<"keep" | "stop" | "hold" | "wait", string> = {
  stop: "Не увеличивать",
  keep: "Оставить",
  hold: "Как есть",
  wait: "Рано",
};

function amount(v: number) {
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function MarketingAdvice({ daily, campaigns, accountSpend, accountLeads, periodEnd, currency }: Props) {
  const reading = useMemo(
    () => readAds({ daily, campaigns, accountSpend, accountLeads, periodEnd, currency }),
    [daily, campaigns, accountSpend, accountLeads, periodEnd, currency],
  );

  return (
    <section className="mkt-advice">
      {reading.alert ? (
        <div className="mkt-advice__warn">
          <span className="mkt-advice__warn-dot" aria-hidden />
          <div>
            <h3>Предупреждение</h3>
            <ul>
              {reading.warningLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <p className="mkt-advice__calm">{reading.warningLines[0]}</p>
      )}

      <div className="mkt-advice__notes">
        <article className="mkt-advice__note">
          <span className="mkt-advice__kicker">Темп</span>
          <p>{reading.paceNote}</p>
        </article>
        <article className="mkt-advice__note mkt-advice__note--forecast">
          <span className="mkt-advice__kicker">Прогноз</span>
          <p>{reading.forecastNote}</p>
        </article>
      </div>

      <div className="mkt-advice__panel">
        <div className="mkt-advice__head">
          <h3 className="mkt-advice__title">Советы по кампаниям</h3>
          {reading.actions.length > 0 ? (
            <span className="mkt-advice__count">{reading.actions.length}</span>
          ) : null}
        </div>
        {reading.actions.length === 0 ? (
          <p className="mkt-advice__empty">Кампаний с расходом за период нет.</p>
        ) : (
          <>
            <div className="mkt-advice__cols mkt-advice__cols--head">
              <span>Кампания</span>
              <span>Расход, {currency}</span>
              <span>Лиды</span>
              <span>Цена, {currency}</span>
            </div>
            <ul className="mkt-advice__list">
              {reading.actions.map((row) => (
                <li key={row.name} className={`mkt-advice__row mkt-advice__cols is-${row.tone}`}>
                  <div className="mkt-advice__main">
                    <div className="mkt-advice__top">
                      <span className="mkt-advice__chip">{CHIP[row.tone]}</span>
                      <div className="mkt-advice__name">{row.name}</div>
                    </div>
                    <p className="mkt-advice__why">{row.text}</p>
                  </div>
                  <span className="mkt-advice__num">{amount(row.spend)}</span>
                  <span className="mkt-advice__num">{Math.round(row.leads).toLocaleString("ru-RU")}</span>
                  <span className="mkt-advice__num">{row.cpl != null ? amount(row.cpl) : "—"}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
