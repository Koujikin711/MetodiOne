import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { apiFetch } from "@/lib/api";
import type { Integration } from "@/lib/types";

export function HorecaDeliveryPage() {
  const integrations = useQuery({
    queryKey: ["horeca-delivery-integrations"],
    queryFn: () => apiFetch<Integration[]>("/api/integrations"),
  });

  const delivery = (integrations.data ?? []).filter((x) =>
    ["telegram", "whatsapp", "google_sheets"].includes(String(x.provider || "").toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 pb-10">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-teal-300/90">HoReCa / Доставка и агрегаторы</p>
        <h1 className="text-3xl font-semibold text-white">Доставка и агрегаторы</h1>
        <p className="text-sm text-slate-400">Единый статус подключённых каналов и быстрый переход в настройки.</p>
      </header>

      <Link to="/integrations" className="inline-block rounded-xl border border-slate-600/50 px-3 py-2 text-xs text-slate-100 hover:bg-slate-800/60">
        Открыть настройки интеграций
      </Link>

      {integrations.isLoading ? <p className="text-sm text-slate-400">Загрузка подключений…</p> : null}
      {integrations.isError ? <p className="text-sm text-rose-300">{(integrations.error as Error).message}</p> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {delivery.map((x) => (
          <div key={x.id} className="rounded-xl border border-slate-700/50 bg-slate-900/45 p-3">
            <p className="text-sm font-medium text-white">{x.name}</p>
            <p className="mt-1 text-xs text-slate-400">Провайдер: {x.provider}</p>
            <p className={`mt-1 text-xs ${x.is_active ? "text-emerald-300" : "text-amber-300"}`}>
              {x.is_active ? "Активно" : "Отключено"}
            </p>
          </div>
        ))}
      </section>

      {!integrations.isLoading && delivery.length === 0 ? (
        <p className="text-sm text-slate-500">Каналы доставки пока не настроены.</p>
      ) : null}
    </div>
  );
}
