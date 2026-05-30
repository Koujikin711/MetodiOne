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
        <h1 className="lux-heading-page">Доставка и агрегаторы</h1>
        <p className="text-sm lux-caption">Единый статус подключённых каналов и быстрый переход в настройки.</p>
      </header>

      <Link to="/integrations" className="inline-block rounded-xl border border-[var(--mo-border-strong)]/50 px-3 py-2 text-xs text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)]">
        Открыть настройки интеграций
      </Link>

      {integrations.isLoading ? <p className="text-sm lux-caption">Загрузка подключений…</p> : null}
      {integrations.isError ? <p className="text-sm text-[#6b1d2f]">{(integrations.error as Error).message}</p> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {delivery.map((x) => (
          <div key={x.id} className="rounded-xl border border-[var(--mo-border)] bg-white p-3">
            <p className="text-sm font-medium text-[var(--mo-text)]">{x.name}</p>
            <p className="mt-1 text-xs lux-caption">Провайдер: {x.provider}</p>
            <p className={`mt-1 text-xs ${x.is_active ? "text-[#0f4c3a]" : "text-amber-300"}`}>
              {x.is_active ? "Активно" : "Отключено"}
            </p>
          </div>
        ))}
      </section>

      {!integrations.isLoading && delivery.length === 0 ? (
        <p className="text-sm mo-muted">Каналы доставки пока не настроены.</p>
      ) : null}
    </div>
  );
}
