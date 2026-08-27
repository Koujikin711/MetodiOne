import { useQuery } from "@tanstack/react-query";

import { apiFetch, getActiveCompanyId, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";

export type ArchiveEveningStats = {
  day: string | null;
  assigned: number;
  managers: number;
  ran_today: boolean;
  has_run: boolean;
};

function formatDay(day: string | null): string {
  if (!day) return "";
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

/** Метка дневной раздачи Архива — только owner/admin. */
export function ArchiveEveningAdminBadge() {
  const role = decodeRoleFromToken(getStoredToken());
  const companyId = getActiveCompanyId();
  const allowed = role === "owner" || role === "admin" || role === "super_owner";

  const statsQ = useQuery({
    queryKey: ["archive-evening-stats", companyId],
    queryFn: () => apiFetch<ArchiveEveningStats>("/api/system/archive-evening-stats"),
    enabled: allowed && companyId != null,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (!allowed) return null;
  if (statsQ.isError || !statsQ.data) return null;

  const s = statsQ.data;
  const text = !s.has_run
    ? "Архив → новые: раздачи ещё не было"
    : s.ran_today
      ? `Архив → новые сегодня: ${s.assigned} (менеджеров: ${s.managers})`
      : `Архив → новые ${formatDay(s.day)}: ${s.assigned} (менеджеров: ${s.managers})`;

  return (
    <div
      className="rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] px-3 py-1.5 text-[11px] text-[var(--mo-text-muted)]"
      title="Видно только администратору. Дневная раздача лидов из Архива менеджерам (около 10:00–14:00)."
    >
      <span className="font-semibold text-[var(--mo-text)]/80">Админ</span>
      <span className="mx-1.5 opacity-40">·</span>
      <span>{text}</span>
    </div>
  );
}
