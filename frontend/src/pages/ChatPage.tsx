import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import type { ChatMessage, ChatThread } from "@/lib/types";

export function ChatPage() {
  const qc = useQueryClient();
  const threadsQuery = useQuery({
    queryKey: ["chat-threads"],
    queryFn: () => apiFetch<ChatThread[]>("/api/chat/threads"),
    refetchInterval: 4000,
  });
  const [threadId, setThreadId] = useState<number | null>(null);
  const [text, setText] = useState("");

  const selectedThread = useMemo(
    () => (threadsQuery.data ?? []).find((t) => t.id === threadId) ?? null,
    [threadsQuery.data, threadId],
  );

  const messagesQuery = useQuery({
    queryKey: ["chat-messages", threadId],
    queryFn: () => apiFetch<ChatMessage[]>(`/api/chat/threads/${threadId}/messages`),
    enabled: !!threadId,
    refetchInterval: 3000,
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      apiFetch<ChatMessage>(`/api/chat/threads/${threadId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => {
      setText("");
      void qc.invalidateQueries({ queryKey: ["chat-messages", threadId] });
      void qc.invalidateQueries({ queryKey: ["chat-threads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="relative mx-auto max-w-[1400px] space-y-4 pb-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Чат</h1>
        <p className="mt-1 text-sm text-slate-400">
          Переписка менеджеров с клиентами. Отправка в WhatsApp работает через GREEN API интеграцию.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-3 shadow-inner backdrop-blur-sm">
          <div className="mb-2 text-sm font-semibold text-white">Диалоги</div>
          {threadsQuery.isLoading && <p className="text-sm text-slate-400">Загрузка…</p>}
          {threadsQuery.isError && (
            <p className="text-sm text-red-300">{(threadsQuery.error as Error).message}</p>
          )}
          <div className="space-y-2">
            {(threadsQuery.data ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setThreadId(t.id)}
                className={[
                  "w-full rounded-xl border px-3 py-2 text-left transition",
                  t.id === threadId
                    ? "border-purple-500/40 bg-purple-500/10"
                    : "border-slate-700/50 bg-slate-900/30 hover:bg-slate-900/50",
                ].join(" ")}
              >
                <div className="truncate text-sm font-semibold text-slate-100">
                  {t.lead_name || t.title || `Диалог #${t.id}`}
                </div>
                <div className="mt-1 truncate text-xs text-slate-400">
                  {t.provider} {t.external_chat_id ? `· ${t.external_chat_id}` : ""}
                </div>
              </button>
            ))}
            {!threadsQuery.isLoading && (threadsQuery.data ?? []).length === 0 && (
              <p className="text-sm text-slate-500">Пока нет диалогов</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4 shadow-inner backdrop-blur-sm">
          {!selectedThread && <p className="text-sm text-slate-500">Выберите диалог слева.</p>}
          {selectedThread && (
            <>
              <div className="mb-3 border-b border-slate-700/50 pb-2">
                <div className="text-sm font-semibold text-white">
                  {selectedThread.lead_name || selectedThread.title || `Диалог #${selectedThread.id}`}
                </div>
                <div className="text-xs text-slate-400">
                  {selectedThread.provider} {selectedThread.external_chat_id ? `· ${selectedThread.external_chat_id}` : ""}
                </div>
              </div>

              <div className="max-h-[56vh] space-y-2 overflow-y-auto pr-1">
                {messagesQuery.isLoading && <p className="text-sm text-slate-400">Загрузка сообщений…</p>}
                {(messagesQuery.data ?? []).map((m) => (
                  <div
                    key={m.id}
                    className={[
                      "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                      m.direction === "out"
                        ? "ml-auto bg-indigo-600/40 text-slate-100"
                        : "bg-slate-900/50 text-slate-200",
                    ].join(" ")}
                  >
                    <div>{m.text}</div>
                    <div className="mt-1 text-[10px] text-slate-400">{m.delivery_status}</div>
                  </div>
                ))}
                {!messagesQuery.isLoading && (messagesQuery.data ?? []).length === 0 && (
                  <p className="text-sm text-slate-500">Нет сообщений.</p>
                )}
              </div>

              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!text.trim()) return;
                  sendMutation.mutate();
                }}
              >
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Сообщение клиенту..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white"
                />
                <button
                  type="submit"
                  disabled={sendMutation.isPending || !text.trim()}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Отправить
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

