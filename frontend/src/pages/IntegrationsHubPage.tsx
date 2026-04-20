import { useQuery } from "@tanstack/react-query";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import type { BackgroundEventRow, Integration, TariffStatus } from "@/lib/types";

import { AccessDenied } from "@/components/AccessDenied";

function fmtTs(ts: string) {
  try {
    return new Date(ts).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" });
  } catch {
    return ts;
  }
}

export function IntegrationsHubPage() {
  const role = decodeRoleFromToken(getStoredToken());
  if (role !== "owner") {
    return (
      <AccessDenied message="Список интеграций и журнал фоновых задач доступны только владельцу компании. Обратитесь к владельцу для настройки каналов." />
    );
  }

  const integrationsQuery = useQuery({
    queryKey: ["integrations"],
    queryFn: () => apiFetch<Integration[]>("/api/integrations"),
  });

  const eventsQuery = useQuery({
    queryKey: ["system-background-events"],
    queryFn: () => apiFetch<BackgroundEventRow[]>("/api/system/background-events?limit=40"),
  });

  const tariffQuery = useQuery({
    queryKey: ["system-tariff"],
    queryFn: () => apiFetch<TariffStatus>("/api/system/tariff"),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-12">
      <div>
        <h1 className="text-2xl font-semibold text-white">Интеграции и фон</h1>
        <p className="mt-2 text-sm text-slate-400">
          Статус подключений и последние события цикла WhatsApp / Google Sheets (серверный опрос).
        </p>
      </div>

      {tariffQuery.data && (
        <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5">
          <h2 className="text-lg font-medium text-white">Тариф и лимиты</h2>
          <p className="mt-1 text-xs text-slate-500">
            Лимиты задаются на сервере переменными окружения{" "}
            <code className="text-slate-400">TARIFF_MAX_ACTIVE_USERS</code>,{" "}
            <code className="text-slate-400">TARIFF_MAX_INTEGRATIONS</code> (0 = без лимита).
          </p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl border border-slate-600/40 bg-slate-900/40 px-3 py-2">
              <dt className="text-xs text-slate-500">Активные пользователи</dt>
              <dd className="mt-1 font-medium text-white">
                {tariffQuery.data.active_users}
                {tariffQuery.data.max_active_users > 0 ? ` / ${tariffQuery.data.max_active_users}` : " (без лимита)"}
              </dd>
            </div>
            <div className="rounded-xl border border-slate-600/40 bg-slate-900/40 px-3 py-2">
              <dt className="text-xs text-slate-500">Интеграции</dt>
              <dd className="mt-1 font-medium text-white">
                {tariffQuery.data.integrations}
                {tariffQuery.data.max_integrations > 0 ? ` / ${tariffQuery.data.max_integrations}` : " (без лимита)"}
              </dd>
            </div>
          </dl>
        </section>
      )}

      <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5">
        <h2 className="text-lg font-medium text-white">Подключённые интеграции</h2>
        {integrationsQuery.isLoading && <p className="mt-2 text-sm text-slate-400">Загрузка…</p>}
        {integrationsQuery.isError && (
          <p className="mt-2 text-sm text-rose-300">{(integrationsQuery.error as Error).message}</p>
        )}
        <ul className="mt-4 space-y-3">
          {(integrationsQuery.data ?? []).map((it) => (
            <li
              key={it.id}
              className="rounded-xl border border-slate-600/40 bg-slate-900/35 px-4 py-3 text-sm text-slate-300"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-white">{it.name}</span>
                <span
                  className={
                    it.is_active ? "rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-200" : "rounded-full bg-slate-600/40 px-2 py-0.5 text-xs text-slate-400"
                  }
                >
                  {it.is_active ? "Активна" : "Выключена"}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Провайдер: <span className="text-slate-400">{it.provider}</span>
                {it.has_api_token ? " · токен сохранён" : " · токен не задан"}
              </div>
              {it.setup_note ? <p className="mt-2 text-xs text-violet-200/90">{it.setup_note}</p> : null}
            </li>
          ))}
        </ul>
        {(integrationsQuery.data ?? []).length === 0 && !integrationsQuery.isLoading && (
          <p className="mt-3 text-sm text-slate-500">Интеграций пока нет. Создайте их через API или будущую форму настроек.</p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5">
        <h2 className="text-lg font-medium text-white">Журнал фоновых задач</h2>
        <p className="mt-1 text-xs text-slate-500">
          Последние записи с сервера (память процесса, до ~120 событий). Для полного аудита см. раздел «Аудит».
        </p>
        {eventsQuery.isLoading && <p className="mt-2 text-sm text-slate-400">Загрузка…</p>}
        {eventsQuery.isError && <p className="mt-2 text-sm text-rose-300">{(eventsQuery.error as Error).message}</p>}
        <div className="mt-4 max-h-80 overflow-auto rounded-xl border border-slate-700/40">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="sticky top-0 bg-slate-900/95 text-slate-500">
              <tr>
                <th className="px-2 py-2">Время</th>
                <th className="px-2 py-2">Источник</th>
                <th className="px-2 py-2">Статус</th>
                <th className="px-2 py-2">Сообщение</th>
              </tr>
            </thead>
            <tbody>
              {(eventsQuery.data ?? []).map((ev, idx) => (
                <tr key={`${ev.ts}-${idx}`} className="border-t border-slate-700/40">
                  <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">{fmtTs(ev.ts)}</td>
                  <td className="px-2 py-1.5 font-mono text-slate-400">{ev.source}</td>
                  <td className="px-2 py-1.5">{ev.ok ? <span className="text-emerald-400">ok</span> : <span className="text-rose-400">ошибка</span>}</td>
                  <td className="px-2 py-1.5 text-slate-300">{ev.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(eventsQuery.data ?? []).length === 0 && !eventsQuery.isLoading && (
          <p className="mt-2 text-sm text-slate-500">Событий пока нет (цикл ещё не писал или не было активности).</p>
        )}
      </section>
    </div>
  );
}
