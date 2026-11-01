import { useMemo } from "react";

import {
  readAds,
  type ForecastCampaign,
  type ForecastCreative,
  type ForecastDay,
  type CreativeTone,
} from "@/lib/marketingForecast";

type Props = {
  daily: ForecastDay[];
  campaigns: ForecastCampaign[];
  creatives?: ForecastCreative[];
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

const CREATIVE_CHIP: Record<CreativeTone, string> = {
  scale: "Увеличить",
  cut: "Уменьшить",
  pause: "Остановить",
  refresh: "Новый ролик",
  hold: "Как есть",
  wait: "Рано",
};

function amount(v: number) {
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function kindLabel(kind: string) {
  if (kind === "video") return "видео";
  if (kind === "image") return "фото";
  if (kind === "carousel") return "карусель";
  return "объявление";
}

export function MarketingAdvice({
  daily,
  campaigns,
  creatives = [],
  accountSpend,
  accountLeads,
  periodEnd,
  currency,
}: Props) {
  const reading = useMemo(
    () => readAds({ daily, campaigns, creatives, accountSpend, accountLeads, periodEnd, currency }),
    [daily, campaigns, creatives, accountSpend, accountLeads, periodEnd, currency],
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
          <h3 className="mkt-advice__title">Советы по роликам</h3>
          {reading.creatives.length > 0 ? (
            <span className="mkt-advice__count">{reading.creatives.length}</span>
          ) : null}
        </div>
        {reading.creatives.length === 0 ? (
          <p className="mkt-advice__empty">
            Объявлений с расходом за период нет. Нажмите «Обновить» — Meta отдаёт ads отдельно от
            кампаний.
          </p>
        ) : (
          <ul className="mkt-advice__creatives">
            {reading.creatives.map((row) => (
              <li key={row.id} className={`mkt-advice__creative is-${row.tone}`}>
                <div className="mkt-advice__creative-top">
                  <span className="mkt-advice__chip">{CREATIVE_CHIP[row.tone]}</span>
                  <span className="mkt-advice__kind">{kindLabel(row.kind)}</span>
                </div>
                <p className="mkt-advice__action">{row.action}</p>
                <p className="mkt-advice__name">
                  {row.name}
                  {row.campaign ? (
                    <span className="mkt-advice__camp"> · {row.campaign}</span>
                  ) : null}
                </p>
                <p className="mkt-advice__why">{row.text}</p>
                <p className="mkt-advice__next">{row.next}</p>
                <div className="mkt-advice__meta">
                  <span>
                    расход {amount(row.spend)} {currency}
                  </span>
                  <span>лиды {Math.round(row.leads).toLocaleString("ru-RU")}</span>
                  <span>CPL {row.cpl != null ? `${amount(row.cpl)} ${currency}` : "—"}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
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
