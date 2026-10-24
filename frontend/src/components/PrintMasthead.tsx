export function printPeriod(from?: string | null, to?: string | null) {
  const fmt = (iso?: string | null) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    if (!m) return "";
    return `${m[3]}.${m[2]}.${m[1]}`;
  };
  const a = fmt(from);
  const b = fmt(to);
  if (a && b && a !== b) return `${a} — ${b}`;
  return a || b;
}

export function printMonthLabel(yearMonth: string) {
  const [ys, ms] = yearMonth.split("-");
  const day = new Date(Number(ys), Number(ms) - 1, 1);
  if (Number.isNaN(day.getTime())) return yearMonth;
  const name = day.toLocaleString("ru-RU", { month: "long", year: "numeric" });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function PrintMasthead({ title, meta }: { title: string; meta?: string }) {
  return (
    <header className="mo-print-head">
      <h1>{title}</h1>
      {meta ? <p>{meta}</p> : null}
    </header>
  );
}

export function PrintSign() {
  return (
    <footer className="mo-print-sign">
      <div>
        <span>Составил</span>
        <i />
      </div>
      <div>
        <span>Проверил</span>
        <i />
      </div>
    </footer>
  );
}
