import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { apiFetch } from "@/lib/api";
import type { ChatThread } from "@/lib/types";

function fmt(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

export function HorecaCommsPage() {
  const threads = useQuery({
    queryKey: ["horeca-comms-threads"],
    queryFn: () => apiFetch<ChatThread[]>("/api/chat/threads?limit=60&offset=0"),
    refetchInterval: 15_000,
  });

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 pb-10">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-teal-300/90">HoReCa / Связь зал ↔ кухня</p>
        <h1 className="text-3xl font-semibold text-white">Оперативная связь зал ↔ кухня</h1>
        <p className="text-sm text-slate-400">Актуальные диалоги, ответственный менеджер и переход в полный чат.</p>
      </header>

      <Link to="/chat" className="inline-block rounded-xl border border-slate-600/50 px-3 py-2 text-xs text-slate-100 hover:bg-slate-800/60">
        Открыть полный чат
      </Link>

      {threads.isLoading ? <p className="text-sm text-slate-400">Загрузка диалогов…</p> : null}
      {threads.isError ? <p className="text-sm text-rose-300">{(threads.error as Error).message}</p> : null}

      <section className="space-y-2">
        {(threads.data ?? []).map((t) => (
          <div key={t.id} className="rounded-xl border border-slate-700/50 bg-slate-900/45 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-white">{t.title || t.lead_name || `Диалог #${t.id}`}</p>
              <span className="text-xs text-slate-500">{fmt(t.updated_at)}</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">Ответственный: {t.manager_name || "Не назначен"} · Непрочитанных: {t.unread_count ?? 0}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
