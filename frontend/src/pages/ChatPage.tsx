import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";

import { apiFetch, resolveMediaUrl } from "@/lib/api";
import type { ChatMessage, ChatThread } from "@/lib/types";

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif)(\?|#|$)/i;

function looksLikeImageAttachment(m: ChatMessage): boolean {
  const mime = (m.media_mime || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  const name = (m.file_name || "").trim();
  if (name && IMAGE_EXT_RE.test(name)) return true;
  const raw = (m.media_url || "").trim();
  if (raw) {
    try {
      const path = new URL(raw, "https://example.com").pathname;
      if (IMAGE_EXT_RE.test(path)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function imageCaptionToShow(m: ChatMessage): string | null {
  const t = (m.text || "").trim();
  if (!t) return null;
  if (t === "📷 Фото" || t === "📎 Вложение") return null;
  const fn = (m.file_name || "").trim();
  if (fn && (t === fn || t === `📎 ${fn}`)) return null;
  return m.text;
}

function MessageBody({ m }: { m: ChatMessage }) {
  const url = resolveMediaUrl(m.media_url);
  const mt = m.message_type ?? "text";
  const showAsImage =
    !!url &&
    mt !== "video" &&
    mt !== "audio" &&
    (mt === "image" || looksLikeImageAttachment(m));

  if (showAsImage && url) {
    const cap = imageCaptionToShow(m);
    return (
      <div className="space-y-2">
        <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg">
          <img src={url} alt="" className="max-h-64 w-full object-contain" />
        </a>
        {cap ? <div>{cap}</div> : null}
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

  if (url) {
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

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        fill="currentColor"
        d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V20H9v2h6v-2h-2v-2.08A7 7 0 0 0 19 11h-2z"
      />
    </svg>
  );
}

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const THREADS_PAGE_SIZE = 20;

/** Зелёный: последнее сообщение от клиента (ждём ответ). Голубой: в пределах 3 суток с первого сообщения в чате. */
type ThreadAttention = "waiting_reply" | "recent_window" | "normal";

function threadAttention(t: ChatThread): ThreadAttention {
  if (t.last_message_direction === "in") return "waiting_reply";
  const raw = t.first_message_at;
  if (!raw) return "normal";
  const first = new Date(raw).getTime();
  if (Number.isNaN(first)) return "normal";
  if (Date.now() - first <= THREE_DAYS_MS) return "recent_window";
  return "normal";
}

function threadRowClasses(t: ChatThread, selected: boolean) {
  const base =
    "flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left transition";
  if (selected) {
    return [base, "border-purple-500/40 bg-purple-500/10"].join(" ");
  }
  const attn = threadAttention(t);
  if (attn === "waiting_reply") {
    return [base, "border-emerald-500/45 bg-emerald-500/10 hover:bg-emerald-500/15"].join(" ");
  }
  if (attn === "recent_window") {
    return [base, "border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/15"].join(" ");
  }
  return [base, "border-slate-700/50 bg-slate-900/30 hover:bg-slate-900/50"].join(" ");
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

  const [threadSearch, setThreadSearch] = useState("");
  const [threadSearchDebounced, setThreadSearchDebounced] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setThreadSearchDebounced(threadSearch.trim()), 220);
    return () => window.clearTimeout(t);
  }, [threadSearch]);

  const threadsQuery = useInfiniteQuery({
    queryKey: ["chat-threads", threadSearchDebounced],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      if (threadSearchDebounced) p.set("q", threadSearchDebounced);
      p.set("limit", String(THREADS_PAGE_SIZE));
      p.set("offset", String(pageParam));
      return apiFetch<ChatThread[]>(`/api/chat/threads?${p.toString()}`);
    },
    getNextPageParam: (lastPage, _pages, lastPageParam) => {
      if (lastPage.length < THREADS_PAGE_SIZE) return undefined;
      return Number(lastPageParam) + lastPage.length;
    },
    refetchInterval: tabVisible ? 2500 : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const [threadId, setThreadId] = useState<number | null>(null);
  const leadFromQuery = Number(searchParams.get("lead_id"));

  useEffect(() => {
    if (!Number.isFinite(leadFromQuery) || leadFromQuery <= 0) return;
    if (threadId != null) return;
    const all = threadsQuery.data?.pages.flatMap((x) => x) ?? [];
    const match = all.find((t) => t.lead_id === leadFromQuery);
    if (match) setThreadId(match.id);
  }, [leadFromQuery, threadId, threadsQuery.data]);

  const [text, setText] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceFinishing, setVoiceFinishing] = useState(false);
  const [voiceDraftFile, setVoiceDraftFile] = useState<File | null>(null);
  const [voiceDraftUrl, setVoiceDraftUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<BlobPart[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const threadIdRef = useRef<number | null>(threadId);
  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  const selectedThread = useMemo(
    () => (threadsQuery.data?.pages.flatMap((x) => x) ?? []).find((t) => t.id === threadId) ?? null,
    [threadsQuery.data, threadId],
  );

  const sortedThreads = useMemo(() => {
    const list = [...(threadsQuery.data?.pages.flatMap((x) => x) ?? [])];
    const score = (t: ChatThread) => {
      const a = threadAttention(t);
      if (a === "waiting_reply") return 3;
      if (a === "recent_window") return 2;
      return 1;
    };
    list.sort((a, b) => {
      const d = score(b) - score(a);
      if (d !== 0) return d;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return list;
  }, [threadsQuery.data]);

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
        if (fileToSend.size === 0) {
          throw new Error("Файл пустой — запишите голос ещё раз.");
        }
        const fd = new FormData();
        fd.append("file", fileToSend);
        if (text.trim()) fd.append("text", text.trim());
        return apiFetch<ChatMessage>(`/api/chat/threads/${threadId}/messages/attachment`, {
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
    if (mr && mr.state === "recording") {
      try {
        mr.requestData();
      } catch {
        /* ignore */
      }
    }
    if (mr && mr.state !== "inactive") mr.stop();
  };

  useEffect(() => {
    return () => {
      stopVoiceRecording();
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (voiceDraftUrl) URL.revokeObjectURL(voiceDraftUrl);
    };
  }, []);

  useEffect(() => {
    stopVoiceRecording();
    recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordStreamRef.current = null;
    setIsRecording(false);
    setVoiceFinishing(false);
    if (voiceDraftUrl) URL.revokeObjectURL(voiceDraftUrl);
    setVoiceDraftUrl(null);
    setVoiceDraftFile(null);
  }, [threadId]);

  const clearVoiceDraft = () => {
    if (voiceDraftUrl) URL.revokeObjectURL(voiceDraftUrl);
    setVoiceDraftUrl(null);
    setVoiceDraftFile(null);
  };

  const startVoiceRecording = async () => {
    if (threadId == null) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Запись голоса не поддерживается в этом браузере");
      return;
    }
    if (sendMutation.isPending || voiceFinishing) return;
    const startedForThread = threadId;
    try {
      setPendingFile(null);
      clearVoiceDraft();
      if (fileInputRef.current) fileInputRef.current.value = "";
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      recordChunksRef.current = [];
      let mime = "";
      if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) mime = "audio/ogg;codecs=opus";
      else if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) mime = "audio/webm;codecs=opus";
      else if (MediaRecorder.isTypeSupported("audio/webm")) mime = "audio/webm";
      else if (MediaRecorder.isTypeSupported("audio/mp4")) mime = "audio/mp4";
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      const chosenMime = mr.mimeType || mime || "audio/webm";
      const isOgg = chosenMime.includes("ogg");
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsRecording(false);
        if (threadIdRef.current !== startedForThread) {
          setVoiceFinishing(false);
          return;
        }
        // WebKit / часть Chrome досылают последний chunk после onstop — без паузы сервер получает пустой файл.
        window.setTimeout(() => {
          if (threadIdRef.current !== startedForThread) {
            setVoiceFinishing(false);
            return;
          }
          const blob = new Blob(recordChunksRef.current, { type: chosenMime });
          if (blob.size < 256) {
            toast.error("Запись слишком короткая");
            setVoiceFinishing(false);
            return;
          }
          const ext =
            chosenMime.includes("mp4") || chosenMime.includes("m4a") || chosenMime.includes("aac")
              ? "m4a"
              : isOgg
                ? "ogg"
                : "webm";
          const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type || chosenMime });
          const url = URL.createObjectURL(blob);
          setVoiceDraftFile(file);
          setVoiceDraftUrl(url);
          setVoiceFinishing(false);
        }, 150);
      };
      // Интервал + пауза после stop: иначе часть браузеров отдаёт 0 байт на сервер.
      mr.start(200);
      setIsRecording(true);
    } catch {
      setVoiceFinishing(false);
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
      recordStreamRef.current = null;
      toast.error("Нет доступа к микрофону. Разрешите запись в настройках браузера.");
    }
  };

  const toggleVoiceRecording = () => {
    if (isRecording) {
      const mr = mediaRecorderRef.current;
      setVoiceFinishing(true);
      if (!mr || mr.state === "inactive") {
        setVoiceFinishing(false);
        setIsRecording(false);
        recordStreamRef.current?.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;
        return;
      }
      stopVoiceRecording();
      return;
    }
    void startVoiceRecording();
  };

  const sendVoiceDraft = () => {
    if (!voiceDraftFile) return;
    sendMutation.mutate(voiceDraftFile, {
      onSuccess: () => clearVoiceDraft(),
      onSettled: () => setVoiceFinishing(false),
    });
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
          <input
            value={threadSearch}
            onChange={(e) => setThreadSearch(e.target.value)}
            placeholder="Поиск: имя, телефон, чат, ключевое слово…"
            className="mb-2 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white placeholder:text-slate-500"
          />
          <p className="mb-2 text-[10px] leading-relaxed text-slate-500">
            Подсветка: зелёный — ждёт вашего ответа · голубой — первые 3 дня с первого сообщения · без заливки —
            старше.
          </p>
          {threadsQuery.isLoading && <p className="text-sm text-slate-400">Загрузка…</p>}
          {threadsQuery.isError && (
            <p className="text-sm text-red-300">{(threadsQuery.error as Error).message}</p>
          )}
          <div
            className="max-h-[62vh] space-y-2 overflow-y-auto pr-1"
            onScroll={(e) => {
              const el = e.currentTarget;
              if (!threadsQuery.hasNextPage || threadsQuery.isFetchingNextPage) return;
              if (el.scrollTop + el.clientHeight < el.scrollHeight - 80) return;
              void threadsQuery.fetchNextPage();
            }}
          >
            {sortedThreads.map((t) => {
              const unread = t.unread_count ?? 0;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setThreadId(t.id)}
                  className={threadRowClasses(t, t.id === threadId)}
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
            {!threadsQuery.isLoading && sortedThreads.length === 0 && (
              <p className="text-sm text-slate-500">Пока нет диалогов</p>
            )}
            {threadsQuery.isFetchingNextPage && (
              <p className="py-1 text-center text-xs text-slate-500">Загрузка ещё…</p>
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
                  if (isRecording || voiceFinishing) return;
                  if (voiceDraftFile) {
                    sendVoiceDraft();
                    return;
                  }
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
                  disabled={isRecording || voiceFinishing || sendMutation.isPending}
                  className="shrink-0 rounded-xl border border-slate-600 bg-slate-900/50 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/80 disabled:opacity-50"
                >
                  Файл
                </button>
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    voiceFinishing
                      ? "Отправка голосового…"
                      : isRecording
                        ? "Идёт запись… нажмите зелёную кнопку ещё раз, чтобы отправить"
                        : voiceDraftFile
                          ? "Голосовое готово — прослушайте и отправьте"
                        : pendingFile
                          ? "Подпись (необязательно)…"
                          : "Сообщение клиенту…"
                  }
                  readOnly={isRecording || voiceFinishing}
                  className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white read-only:opacity-80"
                />
                <button
                  type="button"
                  onClick={toggleVoiceRecording}
                  disabled={sendMutation.isPending || (voiceFinishing && !isRecording) || !!voiceDraftFile}
                  title={
                    isRecording
                      ? "Нажмите ещё раз, чтобы остановить"
                      : "Записать голосовое сообщение"
                  }
                  className={[
                    "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-md transition disabled:opacity-50",
                    isRecording
                      ? "animate-pulse bg-red-600 hover:bg-red-500"
                      : "bg-emerald-600 hover:bg-emerald-500",
                  ].join(" ")}
                  aria-label={isRecording ? "Остановить запись" : "Записать голосовое"}
                >
                  {isRecording ? (
                    <span className="block h-3.5 w-3.5 rounded-sm bg-white" aria-hidden />
                  ) : (
                    <MicIcon className="h-6 w-6" />
                  )}
                </button>
                <button
                  type="submit"
                  disabled={
                    sendMutation.isPending ||
                    isRecording ||
                    voiceFinishing ||
                    (!voiceDraftFile && !text.trim() && !pendingFile)
                  }
                  className="shrink-0 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {voiceDraftFile ? "Отправить голосовое" : "Отправить"}
                </button>
              </form>
              {isRecording && (
                <p className="mt-1 text-xs font-medium text-red-300/90">● Запись… нажмите круглую кнопку ещё раз, чтобы остановить</p>
              )}
              {voiceFinishing && !isRecording && (
                <p className="mt-1 text-xs text-slate-400">Отправка голосового…</p>
              )}
              {voiceDraftUrl && voiceDraftFile && !isRecording && !voiceFinishing && (
                <div className="mt-2 rounded-xl border border-slate-700/50 bg-slate-900/30 p-3">
                  <div className="text-xs font-semibold text-slate-200">Предпрослушивание голосового</div>
                  <audio src={voiceDraftUrl} controls className="mt-2 w-full max-w-md" />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={sendVoiceDraft}
                      disabled={sendMutation.isPending}
                      className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Отправить
                    </button>
                    <button
                      type="button"
                      onClick={clearVoiceDraft}
                      disabled={sendMutation.isPending}
                      className="rounded-xl border border-slate-600 bg-slate-900/50 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
                    >
                      Отменить
                    </button>
                  </div>
                </div>
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
