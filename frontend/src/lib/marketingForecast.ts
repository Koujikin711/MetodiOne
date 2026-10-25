export type ForecastDay = {
  date: string;
  spend: number;
  leads: number;
};

export type ForecastCampaign = {
  name: string;
  spend: number;
  leads: number;
};

export type CampaignAction = {
  name: string;
  tone: "keep" | "stop" | "hold" | "wait";
  spend: number;
  leads: number;
  cpl: number | null;
  text: string;
};

export type AdsReading = {
  alert: boolean;
  warningTitle: string;
  warningLines: string[];
  paceNote: string;
  forecastNote: string;
  projectedSpend: number | null;
  projectedLeads: number | null;
  projectedCpl: number | null;
  actions: CampaignAction[];
};

function num(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

function cpl(spend: number, leads: number): number | null {
  if (leads <= 0) return null;
  return spend / leads;
}

function monthLastDay(iso: string): string {
  const [y, m] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m) return iso.slice(0, 10);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

function daysAfter(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

function perDay(rows: ForecastDay[], key: "spend" | "leads"): number {
  if (!rows.length) return 0;
  const sum = rows.reduce((acc, row) => acc + num(row[key]), 0);
  return sum / rows.length;
}

function timesPhrase(ratio: number): string {
  const rounded = Math.round(ratio * 10) / 10;
  const text = rounded.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  const whole = Math.floor(rounded);
  const mod10 = whole % 10;
  const mod100 = whole % 100;
  const fraction = Math.abs(rounded - whole) > 0.05;
  const word =
    fraction && whole <= 4
      ? "раза"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "раза"
        : "раз";
  return `${text} ${word}`;
}

const RU_MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

export function ruCount(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  const fraction = Math.abs(abs - Math.round(abs)) > 0.05;
  const text = abs.toLocaleString("ru-RU", { maximumFractionDigits: fraction ? 1 : 0 });
  if (fraction) return `${text} ${few}`;
  const whole = Math.round(abs);
  const mod10 = whole % 10;
  const mod100 = whole % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? one
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? few
        : many;
  return `${text} ${word}`;
}

function ruDayMonth(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!m || !d) return iso.slice(0, 10);
  return `${d} ${RU_MONTHS[m - 1] ?? ""}`.trim();
}

function paceWords(recent: number, earlier: number): "ниже" | "выше" | "тот же" {
  if (earlier <= 0 && recent <= 0) return "тот же";
  if (earlier <= 0) return "выше";
  const ratio = recent / earlier;
  if (ratio < 0.85) return "ниже";
  if (ratio > 1.15) return "выше";
  return "тот же";
}

function actionFor(
  camp: ForecastCampaign,
  accountCpl: number | null,
): CampaignAction {
  const spend = num(camp.spend);
  const leads = num(camp.leads);
  const own = cpl(spend, leads);
  const base = {
    name: camp.name,
    spend,
    leads,
    cpl: own,
  };
  if (spend < 1 && leads <= 0) {
    return { ...base, tone: "wait", text: "Расхода ещё нет." };
  }
  if (accountCpl != null && leads >= 8 && own != null && own <= accountCpl * 0.9) {
    return { ...base, tone: "keep", text: "Лид дешевле среднего по кабинету." };
  }
  if (accountCpl != null && leads >= 8 && own != null && own >= accountCpl * 1.4) {
    return { ...base, tone: "stop", text: "Лид дороже среднего." };
  }
  if (accountCpl != null && leads < 8 && spend >= accountCpl * 3) {
    return { ...base, tone: "stop", text: "Расход есть, лидов мало." };
  }
  if (accountCpl == null && spend >= 1) {
    return { ...base, tone: "stop", text: "Лидов Meta по кабинету нет." };
  }
  return { ...base, tone: "hold", text: "Цена около средней." };
}

const TONE_ORDER: Record<CampaignAction["tone"], number> = {
  stop: 0,
  hold: 1,
  keep: 2,
  wait: 3,
};

export function readAds(input: {
  daily: ForecastDay[];
  campaigns: ForecastCampaign[];
  accountSpend: number;
  accountLeads: number;
  periodEnd: string;
  currency?: string;
}): AdsReading {
  const daily = [...input.daily]
    .filter((row) => row.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const accountSpend = num(input.accountSpend);
  const accountLeads = num(input.accountLeads);
  const shown = input.campaigns.filter((camp) => num(camp.spend) >= 1 || num(camp.leads) > 0);
  const shownSpend = shown.reduce((sum, camp) => sum + num(camp.spend), 0);
  const shownLeads = shown.reduce((sum, camp) => sum + num(camp.leads), 0);
  const accountCpl = cpl(shownSpend, shownLeads) ?? cpl(accountSpend, accountLeads);

  let paceNote = "Дней мало, сравнение темпа внутри периода не строится.";
  let leadPace: "ниже" | "выше" | "тот же" = "тот же";
  let costPace: "ниже" | "выше" | "тот же" = "тот же";
  let recent = daily;
  if (daily.length >= 4) {
    const recentCount = daily.length >= 8 ? 7 : Math.max(2, Math.floor(daily.length / 2));
    recent = daily.slice(-recentCount);
    const earlier = daily.slice(0, -recentCount);
    const recentLeads = perDay(recent, "leads");
    const earlierLeads = perDay(earlier, "leads");
    const recentCpl = cpl(perDay(recent, "spend") * recent.length, perDay(recent, "leads") * recent.length);
    const earlierCpl = cpl(perDay(earlier, "spend") * earlier.length, perDay(earlier, "leads") * earlier.length);
    leadPace = paceWords(recentLeads, earlierLeads);
    costPace = recentCpl != null && earlierCpl != null ? paceWords(earlierCpl, recentCpl) : "тот же";
    const costText =
      costPace === "ниже"
        ? "лид стал дороже"
        : costPace === "выше"
          ? "лид стал дешевле"
          : "цена лида почти та же";
    paceNote = `За последние ${recent.length} дн. — ${ruCount(recentLeads, "лид", "лида", "лидов")} в день. В начале периода было ${ruCount(earlierLeads, "лид", "лида", "лидов")}. Темп ${leadPace}, ${costText}.`;
  } else if (daily.length > 0) {
    paceNote = "Дней мало, сравнение темпа внутри периода не строится. Прогноз идёт по всем дням, которые пришли из Meta.";
  }

  const daysLeft = daysAfter(input.periodEnd, monthLastDay(input.periodEnd));
  const horizon = daysLeft > 0 ? daysLeft : 7;
  const horizonLabel = daysLeft > 0 ? `к ${ruDayMonth(monthLastDay(input.periodEnd))}` : "ещё 7 дней";
  const leadRate = perDay(recent, "leads");
  const spendRate = perDay(recent, "spend");
  let forecastNote = "Дневного ряда Meta нет, прогноз не строится.";
  let projectedSpend: number | null = null;
  let projectedLeads: number | null = null;
  let projectedCpl: number | null = null;
  if (recent.length > 0) {
    const addLeads = leadRate * horizon;
    const addSpend = spendRate * horizon;
    projectedSpend = daysLeft > 0 ? accountSpend + addSpend : addSpend;
    projectedLeads = daysLeft > 0 ? accountLeads + addLeads : addLeads;
    projectedCpl = cpl(projectedSpend, projectedLeads);
    const unit = input.currency || "USD";
    const spendText = `${projectedSpend.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ${unit}`;
    const leadText = ruCount(Math.round(projectedLeads), "лид", "лида", "лидов");
    forecastNote = daysLeft > 0
      ? `Если темп последних ${recent.length} дн. сохранится, ${horizonLabel} расход будет около ${spendText} и около ${leadText} Meta.`
      : `Период закрыт. Если тот же темп продлится ${horizonLabel}: около ${spendText} и ${leadText}.`;
  }

  const actions = shown
    .map((camp) => actionFor(camp, accountCpl))
    .sort((a, b) => {
      const byTone = TONE_ORDER[a.tone] - TONE_ORDER[b.tone];
      if (byTone) return byTone;
      const byPrice = (b.cpl ?? -1) - (a.cpl ?? -1);
      if (byPrice) return byPrice;
      return b.spend - a.spend;
    });

  const warningLines: string[] = [];
  if (leadPace === "ниже") {
    warningLines.push("Темп лидов упал к концу периода. Новый бюджет в дорогие кампании не добавлять.");
  }
  if (costPace === "ниже") {
    warningLines.push("Лид стал дороже, чем в начале периода.");
  }
  for (const row of actions) {
    if (row.tone !== "stop") continue;
    const dear =
      accountCpl != null && row.cpl != null && accountCpl > 0
        ? ` Лид дороже среднего в ${timesPhrase(row.cpl / accountCpl)}.`
        : "";
    warningLines.push(`«${row.name}»: не увеличивать бюджет.${dear}`);
  }
  const alert = warningLines.length > 0;

  return {
    alert,
    warningTitle: alert ? "Предупреждение по рекламе" : "Предупреждений нет",
    warningLines: alert ? warningLines : ["По этим цифрам бюджет менять не нужно."],
    paceNote,
    forecastNote,
    projectedSpend,
    projectedLeads,
    projectedCpl,
    actions,
  };
}
