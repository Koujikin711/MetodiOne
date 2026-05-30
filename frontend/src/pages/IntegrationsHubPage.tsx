import { useQuery } from "@tanstack/react-query";

import { AccessDenied } from "@/components/AccessDenied";
import { IntegrationSetupPanel } from "@/components/integrations/IntegrationSetupPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import type { BackgroundEventRow, TariffStatus } from "@/lib/types";

function fmtTs(ts: string) {
  try {
    return new Date(ts).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" });
  } catch {
    return ts;
  }
}

function limitLabel(current: number, max: number) {
  if (max <= 0) return `${current} · без ограничения по тарифу`;
  return `${current} из ${max}`;
}

export function IntegrationsHubPage() {
  const role = decodeRoleFromToken(getStoredToken());
  if (role !== "owner") {
    return (
      <AccessDenied message="Раздел «Интеграции» доступен владельцу компании. Попросите владельца подключить каналы или выдать вам соответствующие права." />
    );
  }

  const eventsQuery = useQuery({
    queryKey: ["system-background-events"],
    queryFn: () => apiFetch<BackgroundEventRow[]>("/api/system/background-events?limit=40"),
  });

  const tariffQuery = useQuery({
    queryKey: ["system-tariff"],
    queryFn: () => apiFetch<TariffStatus>("/api/system/tariff"),
  });

  const t = tariffQuery.data;

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <PageHeader
        title="Интеграции"
        description="Подключите мессенджеры, почту и таблицы — входящие обращения и лиды будут попадать в CRM. Ниже — лимиты тарифа и журнал фоновых задач."
      />

      {t ? (
        <section className="mo-section">
          <h2 className="lux-heading">Тариф и лимиты</h2>
          <p className="lux-caption mt-2">
            Ограничения зависят от вашего тарифного плана. При необходимости расширения лимитов обратитесь к
            администратору платформы или смените тариф в разделе «Оплата и тариф».
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="mo-kpi">
              <dt className="mo-kpi-label">Активные пользователи</dt>
              <dd className="mo-kpi-value text-xl">{limitLabel(t.active_users, t.max_active_users)}</dd>
            </div>
            <div className="mo-kpi">
              <dt className="mo-kpi-label">Подключённые каналы</dt>
              <dd className="mo-kpi-value text-xl">{limitLabel(t.integrations, t.max_integrations)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <IntegrationSetupPanel />

      <section className="mo-section">
        <h2 className="lux-heading">Журнал фоновых задач</h2>
        <p className="lux-caption mt-2">
          Последние операции синхронизации и опроса каналов. Для полной истории действий сотрудников откройте раздел
          «Аудит».
        </p>
        {eventsQuery.isLoading && <p className="lux-body mt-3">Загрузка…</p>}
        {eventsQuery.isError && (
          <p className="mt-3 text-sm text-[#6B1D2F]">{(eventsQuery.error as Error).message}</p>
        )}
        <div className="mt-4 max-h-80 overflow-auto rounded-xl border border-[#E1D9C6] bg-white">
          <table className="mo-table min-w-full text-xs">
            <thead className="sticky top-0 bg-[#FAF8F4]">
              <tr>
                <th className="px-3 py-2 font-semibold">Время</th>
                <th className="px-3 py-2 font-semibold">Источник</th>
                <th className="px-3 py-2 font-semibold">Статус</th>
                <th className="px-3 py-2 font-semibold">Сообщение</th>
              </tr>
            </thead>
            <tbody>
              {(eventsQuery.data ?? []).map((ev, idx) => (
                <tr key={`${ev.ts}-${idx}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-[#A89880]">{fmtTs(ev.ts)}</td>
                  <td className="px-3 py-2 font-medium text-[#7A7265]">{ev.source}</td>
                  <td className="px-3 py-2">
                    {ev.ok ? (
                      <span className="font-semibold text-[#0F4C3A]">Успешно</span>
                    ) : (
                      <span className="font-semibold text-[#6B1D2F]">Ошибка</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[#2C2520]">{ev.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(eventsQuery.data ?? []).length === 0 && !eventsQuery.isLoading && (
          <p className="lux-body mt-3">Записей пока нет — они появятся после первой синхронизации или опроса каналов.</p>
        )}
      </section>
    </div>
  );
}
