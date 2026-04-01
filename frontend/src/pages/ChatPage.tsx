import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";

import { apiFetch, resolveMediaUrl } from "@/lib/api";
import type { ChatMessage, ChatThread } from "@/lib/types";

function MessageBody({ m }: { m: ChatMessage }) {
  const url = resolveMediaUrl(m.media_url);
  const mt = m.message_type ?? "text";

  if (mt === "image" && url) {
    return (
      <div className="space-y-2">
        <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg">
          <img src={url} alt="" className="max-h-64 w-full object-contain" />
        </a>
        {m.text && m.text !== "📷 Фото" && <div>{m.text}</div>}
      </div>
    );
  }

  if (mt === "video" && url) {
    return (
      <div className="space-y-2">
        <video src={url} controls className="max-h-64 w-full rounded-lg" />
        {m.text && m.text !== "🎬 Видео" && <div>{m.text}</div>}
      </div>
    );
  }

  if (mt === "audio" && url) {
    return (
      <div className="space-y-2">
        <audio src={url} controls className="w-full max-w-sm" />
        {m.text && !m.text.startsWith("🎵") && !m.text.startsWith("🎤") && <div>{m.text}</div>}
      </div>
    );
  }

  if ((mt === "document" || url) && url) {
    return (
      <div className="space-y-2">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-indigo-300 underline underline-offset-2 hover:text-indigo-200"
        >
          {m.file_name || "Скачать файл"}
        </a>
        {m.text && <div>{m.text}</div>}
      </div>
    );
  }

  return <div>{m.text}</div>;
}

export function ChatPage() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const threadsQuery = useQuery({
    queryKey: ["chat-threads"],
    queryFn: () => apiFetch<ChatThread[]>("/api/chat/threads"),
    refetchInterval: 4000,
  });
  const [threadId, setThreadId] = useState<number | null>(null);
  const leadFromQuery = Number(searchParams.get("lead_id"));

  useEffect(() => {
    if (!Number.isFinite(leadFromQuery) || leadFromQuery <= 0) return;
    if (threadId != null) return;
    const match = (threadsQuery.data ?? []).find((t) => t.lead_id === leadFromQuery);
    if (match) setThreadId(match.id);
  }, [leadFromQuery, threadId, threadsQuery.data]);

  const [text, setText] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);

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
    mutationFn: async () => {
      if (threadId == null) throw new Error("Нет диалога");
      if (pendingFile) {
        const fd = new FormData();
        fd.append("file", pendingFile);
        if (text.trim()) fd.append("text", text.trim());
        return apiFetch<ChatMessage>(`/api/chat/threads/${threadId}/messages`, {
          method: "POST",
          body: fd,
        });
      }
      if (!text.trim()) throw new Error("Пустое сообщение");
      return apiFetch<ChatMessage>(`/api/chat/threads/${threadId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
    },
    onSuccess: () => {
      setText("");
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
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
          Переписка с клиентами (WhatsApp через GREEN API): текст, фото, видео, голос, файлы.
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
                  {selectedThread.provider}{" "}
                  {selectedThread.external_chat_id ? `· ${selectedThread.external_chat_id}` : ""}
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
                    <MessageBody m={m} />
                    <div className="mt-1 text-[10px] text-slate-400">{m.delivery_status}</div>
                  </div>
                ))}
                {!messagesQuery.isLoading && (messagesQuery.data ?? []).length === 0 && (
                  <p className="text-sm text-slate-500">Нет сообщений.</p>
                )}
              </div>

              <form
                className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!text.trim() && !pendingFile) return;
                  sendMutation.mutate();
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.zip"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setPendingFile(f ?? null);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="shrink-0 rounded-xl border border-slate-600 bg-slate-900/50 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/80"
                >
                  Файл
                </button>
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={pendingFile ? "Подпись (необязательно)…" : "Сообщение клиенту…"}
                  className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white"
                />
                <button
                  type="submit"
                  disabled={sendMutation.isPending || (!text.trim() && !pendingFile)}
                  className="shrink-0 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Отправить
                </button>
              </form>
              {pendingFile && (
                <p className="mt-1 text-xs text-slate-400">Вложение: {pendingFile.name}</p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
