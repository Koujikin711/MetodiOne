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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [tabVisible, setTabVisible] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "visible",
  );

  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const threadsQuery = useQuery({
    queryKey: ["chat-threads"],
    queryFn: () => apiFetch<ChatThread[]>("/api/chat/threads"),
    refetchInterval: tabVisible ? 2500 : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
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
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<BlobPart[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);

  const selectedThread = useMemo(
    () => (threadsQuery.data ?? []).find((t) => t.id === threadId) ?? null,
    [threadsQuery.data, threadId],
  );

  const messagesQuery = useQuery({
    queryKey: ["chat-messages", threadId],
    queryFn: () => apiFetch<ChatMessage[]>(`/api/chat/threads/${threadId}/messages`),
    enabled: !!threadId,
    refetchInterval: tabVisible && threadId ? 2000 : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const lastMsgId = messagesQuery.data?.at(-1)?.id;
  const msgCount = messagesQuery.data?.length ?? 0;
  useEffect(() => {
    if (msgCount === 0) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [threadId, lastMsgId, msgCount]);

  useEffect(() => {
    if (threadId == null || !messagesQuery.isSuccess) return;
    void qc.invalidateQueries({ queryKey: ["chat-threads"] });
  }, [threadId, messagesQuery.isSuccess, qc]);

  const sendMutation = useMutation({
    mutationFn: async (voiceOrOverrideFile?: File) => {
      if (threadId == null) throw new Error("Нет диалога");
      const fileToSend = voiceOrOverrideFile ?? pendingFile;
      if (fileToSend) {
        const fd = new FormData();
        fd.append("file", fileToSend);
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

  const stopVoiceRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
  };

  useEffect(() => {
    return () => {
      stopVoiceRecording();
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startVoiceRecording = async () => {
    if (threadId == null) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Запись голоса не поддерживается в этом браузере");
      return;
    }
    if (sendMutation.isPending) return;
    try {
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      recordChunksRef.current = [];
      let mime = "";
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) mime = "audio/webm;codecs=opus";
      else if (MediaRecorder.isTypeSupported("audio/webm")) mime = "audio/webm";
      else if (MediaRecorder.isTypeSupported("audio/mp4")) mime = "audio/mp4";
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      const chosenMime = mr.mimeType || mime || "audio/webm";
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsRecording(false);
        const blob = new Blob(recordChunksRef.current, { type: chosenMime });
        if (blob.size < 256) {
          toast.error("Запись слишком короткая");
          return;
        }
        const ext =
          chosenMime.includes("mp4") || chosenMime.includes("m4a") || chosenMime.includes("aac")
            ? "m4a"
            : "webm";
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type || chosenMime });
        sendMutation.mutate(file);
      };
      mr.start(120);
      setIsRecording(true);
    } catch {
      toast.error("Нет доступа к микрофону. Разрешите запись в настройках браузера.");
    }
  };

  const toggleVoiceRecording = () => {
    if (isRecording) stopVoiceRecording();
    else void startVoiceRecording();
  };

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
            {(threadsQuery.data ?? []).map((t) => {
              const unread = t.unread_count ?? 0;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setThreadId(t.id)}
                  className={[
                    "flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left transition",
                    t.id === threadId
                      ? "border-purple-500/40 bg-purple-500/10"
                      : "border-slate-700/50 bg-slate-900/30 hover:bg-slate-900/50",
                  ].join(" ")}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-100">
                      {t.lead_name || t.title || `Диалог #${t.id}`}
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-400">
                      {t.provider} {t.external_chat_id ? `· ${t.external_chat_id}` : ""}
                    </div>
                  </div>
                  {unread > 0 ? (
                    <span
                      className="mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1 text-[11px] font-bold leading-none text-white shadow-sm tabular-nums"
                      title={`Непрочитано: ${unread}`}
                    >
                      {unread > 99 ? "99+" : unread}
                    </span>
                  ) : null}
                </button>
              );
            })}
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
                <div ref={messagesEndRef} aria-hidden />
              </div>

              <form
                className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (isRecording) return;
                  if (!text.trim() && !pendingFile) return;
                  sendMutation.mutate(undefined);
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
                  disabled={isRecording || sendMutation.isPending}
                  className="shrink-0 rounded-xl border border-slate-600 bg-slate-900/50 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/80 disabled:opacity-50"
                >
                  Файл
                </button>
                <button
                  type="button"
                  onClick={toggleVoiceRecording}
                  disabled={sendMutation.isPending}
                  title={isRecording ? "Остановить и отправить голосовое" : "Записать голосовое сообщение"}
                  className={[
                    "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-lg transition disabled:opacity-50",
                    isRecording
                      ? "animate-pulse border-red-500/60 bg-red-500/25 text-red-100"
                      : "border-slate-600 bg-slate-900/50 text-slate-200 hover:bg-slate-800/80",
                  ].join(" ")}
                  aria-label={isRecording ? "Остановить запись" : "Записать голосовое"}
                >
                  <span aria-hidden>{isRecording ? "■" : "🎤"}</span>
                </button>
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    isRecording
                      ? "Идёт запись… нажмите 🎤 ещё раз, чтобы отправить"
                      : pendingFile
                        ? "Подпись (необязательно)…"
                        : "Сообщение клиенту…"
                  }
                  readOnly={isRecording}
                  className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white read-only:opacity-80"
                />
                <button
                  type="submit"
                  disabled={
                    sendMutation.isPending || isRecording || (!text.trim() && !pendingFile)
                  }
                  className="shrink-0 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Отправить
                </button>
              </form>
              {isRecording && (
                <p className="mt-1 text-xs font-medium text-red-300/90">● Запись голосового…</p>
              )}
              {pendingFile && !isRecording && (
                <p className="mt-1 text-xs text-slate-400">Вложение: {pendingFile.name}</p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
