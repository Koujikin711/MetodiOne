/** Предыдущий период той же длительности, заканчивающийся днём до начала текущего (для сравнения KPI). */
export function previousPeriodRange(
  dateFrom: string,
  dateTo: string,
): { from: string; to: string } | null {
  const d0 = new Date(`${dateFrom}T12:00:00`);
  const d1 = new Date(`${dateTo}T12:00:00`);
  if (Number.isNaN(d0.getTime()) || Number.isNaN(d1.getTime()) || d1 < d0) return null;
  const span = d1.getTime() - d0.getTime();
  const prevTo = new Date(d0.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - span);
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  return { from: fmt(prevFrom), to: fmt(prevTo) };
}
