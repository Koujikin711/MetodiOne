import { useEffect, useMemo, useState } from "react";

type Props = {
  value: string;
  onChange: (isoDate: string) => void;
  compact?: boolean;
};

const weekDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m || 1, d: d || 1 };
}

export function MiniMonthCalendar({ value, onChange, compact = false }: Props) {
  const selected = parseYmd(value);
  const [view, setView] = useState(() => ({ y: selected.y, m: selected.m }));

  useEffect(() => {
    const { y, m } = parseYmd(value);
    setView((prev) => (prev.y === y && prev.m === m ? prev : { y, m }));
  }, [value]);

  const { label, cells } = useMemo(() => {
    const first = new Date(view.y, view.m - 1, 1);
    const last = new Date(view.y, view.m, 0);
    const startPad = (first.getDay() + 6) % 7;
    const daysInMonth = last.getDate();
    const cells: { day: number | null; iso: string | null; isToday: boolean }[] = [];
    const today = new Date();
    const tY = today.getFullYear();
    const tM = today.getMonth() + 1;
    const tD = today.getDate();

    for (let i = 0; i < startPad; i++) cells.push({ day: null, iso: null, isToday: false });
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${view.y}-${String(view.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({
        day: d,
        iso,
        isToday: view.y === tY && view.m === tM && d === tD,
      });
    }
    const months = [
      "Январь",
      "Февраль",
      "Март",
      "Апрель",
      "Май",
      "Июнь",
      "Июль",
      "Август",
      "Сентябрь",
      "Октябрь",
      "Ноябрь",
      "Декабрь",
    ];
    return { label: `${months[view.m - 1]} ${view.y}`, cells };
  }, [view]);

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.y, v.m - 1 + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() + 1 };
    });
  }

  return (
    <div className={["mini-cal", compact ? "mini-cal--compact mini-month-calendar--compact" : ""].filter(Boolean).join(" ")}>
      <div className="mini-cal__head">
        <button type="button" className="mini-cal__nav" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
          ‹
        </button>
        <span className="mini-cal__title">{label}</span>
        <button type="button" className="mini-cal__nav" onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
          ›
        </button>
      </div>
      <div className="mini-cal__grid">
        {weekDays.map((w) => (
          <div key={w} className="mini-cal__wd">
            {w}
          </div>
        ))}
        {cells.map((c, i) => {
          const iso = c.iso ?? null;
          if (c.day == null || iso == null) return <div key={`e-${i}`} className="mini-cal__empty" />;
          const selected = iso === value;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onChange(iso)}
              className={[
                "mini-cal__day",
                selected ? "is-selected" : "",
                c.isToday && !selected ? "is-today" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {c.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
