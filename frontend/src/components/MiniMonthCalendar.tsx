import { useEffect, useMemo, useState } from "react";

type Props = {
  value: string;
  onChange: (isoDate: string) => void;
};

const weekDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m || 1, d: d || 1 };
}

export function MiniMonthCalendar({ value, onChange }: Props) {
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
    <div className="max-w-[250px] rounded-xl border border-slate-700/50 bg-slate-900/35 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-1.5">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="rounded-md px-1.5 py-0.5 text-slate-400 hover:bg-white/5 hover:text-white"
          aria-label="Предыдущий месяц"
        >
          ‹
        </button>
        <span className="text-xs font-semibold text-white">{label}</span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="rounded-md px-1.5 py-0.5 text-slate-400 hover:bg-white/5 hover:text-white"
          aria-label="Следующий месяц"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[9px] font-medium uppercase text-slate-500">
        {weekDays.map((w) => (
          <div key={w} className="py-0.5">
            {w}
          </div>
        ))}
        {cells.map((c, i) =>
          c.day == null || c.iso == null ? (
            <div key={`e-${i}`} />
          ) : (
            <button
              key={c.iso}
              type="button"
              onClick={() => onChange(c.iso)}
              className={[
                "rounded-md py-1 text-[11px] font-medium transition-colors",
                c.iso === value
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/30"
                  : c.isToday
                    ? "bg-white/10 text-white ring-1 ring-purple-500/40"
                    : "text-slate-300 hover:bg-white/5",
              ].join(" ")}
            >
              {c.day}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
