import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";

import { PatientPhone, displayPatientPhone } from "@/components/PatientPhone";
import { useChatRealtime } from "@/hooks/useChatRealtime";
import { apiFetch, getStoredToken, resolveMediaUrl } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import type { ChatMessage, ChatThread, ChatThreadBucket, ChatThreadBucketCounts } from "@/lib/types";

function threadPhoneForDisplay(t: ChatThread): string {
  const fromLead = displayPatientPhone({
    phone: t.lead_phone,
    phone_display: t.lead_phone_display,
  });
  if (fromLead !== "—") return fromLead;
  const ext = (t.external_chat_id || "").trim();
  if (!ext) return "—";
  const local = ext.includes("@") ? ext.split("@")[0] : ext;
  const digits = local.replace(/\D/g, "");
  if (digits.length >= 9) {
    return digits.startsWith("992") ? `+${digits}` : `+992${digits}`;
  }
  return local || "—";
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif)(\?|#|$)/i;

function formatChatTime(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(d);
  } catch {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
}

type DeliveryTone = "neutral" | "good" | "seen" | "bad";

function deliveryMeta(statusRaw: string | null | undefined): { label: string; tone: DeliveryTone } {
  const s = (statusRaw || "").trim().toLowerCase();
  if (!s) return { label: "", tone: "neutral" };
  if (s === "read" || s === "seen" || s === "viewed") return { label: "Просмотрено", tone: "seen" };
  if (s === "delivered") return { label: "Доставлено", tone: "good" };
  if (s === "sent") return { label: "Отправлено", tone: "neutral" };
  if (s === "sending") return { label: "Отправка…", tone: "neutral" };
  if (s === "failed" || s === "error") return { label: "Не отправлено", tone: "bad" };
  return { label: statusRaw || "", tone: "neutral" };
}

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

const CHAT_BUCKET_TABS: { id: ChatThreadBucket; label: string; hint: string }[] = [
  { id: "transferred", label: "Переданные", hint: "После перераспределения" },
  { id: "own", label: "Мои", hint: "Изначально ваши" },
  { id: "awaiting_reply", label: "Ждут ответа", hint: "Клиент написал — вы нет" },
  { id: "sold", label: "Проданные", hint: "Закрытые сделки" },
];

function formatSaleMoney(raw: string | null | undefined): string {
  if (!raw) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);
}

function saleSummaryLine(t: ChatThread): string | null {
  if (!t.sale_service_title && !t.sale_amount && !t.sale_paid_amount) return null;
  const paid = formatSaleMoney(t.sale_paid_amount);
  const total = formatSaleMoney(t.sale_amount);
  const svc = (t.sale_service_title || "Услуга").trim();
  return `${svc} · оплачено ${paid}${total !== "—" ? ` из ${total}` : ""}`;
}

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
    "flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left transition max-lg:px-2.5 max-lg:py-1.5";
  if (selected) {
    return [base, "border-[#2f5f85] bg-[#e8f0f7] ring-1 ring-[#2f5f85]/25"].join(" ");
  }
  const attn = threadAttention(t);
  if (attn === "waiting_reply") {
    return [
      base,
      "border-[#6db89a] bg-[#edf7f1] hover:bg-[#e3f3ea] ring-1 ring-[#2d6a5a]/15",
    ].join(" ");
  }
  if (attn === "recent_window") {
    return [base, "border-[#8eb4d4] bg-[#eef4fa] hover:bg-[#e5eff8] ring-1 ring-[#2f5f85]/10"].join(" ");
  }
  return [base, "border-[#d8d2c6] bg-white hover:border-[#2f5f85]/30 hover:shadow-sm"].join(" ");
}

export function ChatPage() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const threadsListRef = useRef<HTMLDivElement>(null);
  const threadsLoadMoreRef = useRef<HTMLDivElement>(null);
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
  const userRole = decodeRoleFromToken(getStoredToken());
  const showManagerChatBuckets = userRole === "manager" || userRole === "admin";
  const [chatBucket, setChatBucket] = useState<ChatThreadBucket>("own");

  useChatRealtime(userRole === "manager" || userRole === "admin" || userRole === "owner");

  useEffect(() => {
    const t = window.setTimeout(() => setThreadSearchDebounced(threadSearch.trim()), 220);
    return () => window.clearTimeout(t);
  }, [threadSearch]);

  const bucketCountsQuery = useQuery({
    queryKey: ["chat-thread-bucket-counts", threadSearchDebounced],
    queryFn: () => {
      const p = new URLSearchParams();
      if (threadSearchDebounced) p.set("q", threadSearchDebounced);
      return apiFetch<ChatThreadBucketCounts>(`/api/chat/threads/bucket-counts?${p.toString()}`);
    },
    enabled: showManagerChatBuckets,
    refetchInterval: tabVisible ? 6000 : false,
    refetchOnWindowFocus: false,
  });

  const threadsQuery = useInfiniteQuery({
    queryKey: ["chat-threads", threadSearchDebounced, showManagerChatBuckets ? chatBucket : "all"],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      if (threadSearchDebounced) p.set("q", threadSearchDebounced);
      if (showManagerChatBuckets) p.set("bucket", chatBucket);
      p.set("limit", String(THREADS_PAGE_SIZE));
      p.set("offset", String(pageParam));
      return apiFetch<ChatThread[]>(`/api/chat/threads?${p.toString()}`);
    },
    getNextPageParam: (lastPage, _pages, lastPageParam) => {
      if (lastPage.length < THREADS_PAGE_SIZE) return undefined;
      return Number(lastPageParam) + lastPage.length;
    },
    refetchInterval: tabVisible ? 6000 : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
  const [threadId, setThreadId] = useState<number | null>(null);
  /** Снимок открытого диалога — не теряется, если после ответа он выпал из вкладки/списка. */
  const [pinnedThread, setPinnedThread] = useState<ChatThread | null>(null);
  const leadFromQuery = Number(searchParams.get("lead_id"));

  const allThreads = useMemo(() => {
    const pages = threadsQuery.data?.pages ?? [];
    const seen = new Set<number>();
    const merged: ChatThread[] = [];
    for (const page of pages) {
      for (const t of page) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        merged.push(t);
      }
    }
    return merged;
  }, [threadsQuery.data]);

  useEffect(() => {
    if (!Number.isFinite(leadFromQuery) || leadFromQuery <= 0) return;
    if (threadId != null) return;
    const match = allThreads.find((t) => t.lead_id === leadFromQuery);
    if (match) openThread(match);
  }, [leadFromQuery, threadId, allThreads]);

  function openThread(t: ChatThread) {
    setThreadId(t.id);
    setPinnedThread(t);
  }

  function closeChat() {
    setThreadId(null);
    setPinnedThread(null);
  }

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

  const selectedThread = useMemo(() => allThreads.find((t) => t.id === threadId) ?? null, [allThreads, threadId]);

  useEffect(() => {
    if (threadId == null) {
      setPinnedThread(null);
      return;
    }
    if (selectedThread) setPinnedThread(selectedThread);
  }, [threadId, selectedThread]);

  const activeThread = useMemo(() => {
    if (threadId == null) return null;
    if (pinnedThread?.id === threadId) return pinnedThread;
    return selectedThread;
  }, [threadId, pinnedThread, selectedThread]);

  const selectedManagerLabel = useMemo(() => {
    const raw = (activeThread?.manager_name || "").trim();
    if (raw) return raw;
    return "—";
  }, [activeThread?.manager_name]);

  const showListOnMobile = threadId == null;
  const displayThreads = useMemo(() => {
    const list = [...allThreads];
    if (!showManagerChatBuckets) {
      list.sort((a, b) => {
        const aw = a.last_message_direction === "in" ? 1 : 0;
        const bw = b.last_message_direction === "in" ? 1 : 0;
        if (bw !== aw) return bw - aw;
        const ts = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        if (ts !== 0) return ts;
        return b.id - a.id;
      });
    }
    return list;
  }, [allThreads, showManagerChatBuckets]);

  useEffect(() => {
    if (!showManagerChatBuckets) return;
    closeChat();
  }, [chatBucket, showManagerChatBuckets]);

  const messagesQuery = useQuery({
    queryKey: ["chat-messages", threadId],
    queryFn: () => apiFetch<ChatMessage[]>(`/api/chat/threads/${threadId}/messages?limit=120&offset=0`),
    enabled: !!threadId,
    refetchInterval: tabVisible && threadId ? 5000 : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    if (!threadsQuery.hasNextPage || threadsQuery.isFetchingNextPage) return;
    const root = threadsListRef.current;
    const target = threadsLoadMoreRef.current;
    if (!root || !target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting);
        if (!hit) return;
        if (!threadsQuery.hasNextPage || threadsQuery.isFetchingNextPage) return;
        void threadsQuery.fetchNextPage();
      },
      { root, rootMargin: "120px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [threadsQuery.hasNextPage, threadsQuery.isFetchingNextPage, threadsQuery.fetchNextPage, displayThreads.length]);

  const lastMsgId = messagesQuery.data?.at(-1)?.id;
  const msgCount = messagesQuery.data?.length ?? 0;
  useEffect(() => {
    if (msgCount === 0) return;
    const box = messagesScrollRef.current;
    if (!box) return;
    box.scrollTo({ top: box.scrollHeight, behavior: "auto" });
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
      void qc.invalidateQueries({ queryKey: ["chat-thread-bucket-counts"] });
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

  const mobileChatHeight =
    "max-lg:h-[calc(100dvh-5.75rem-env(safe-area-inset-bottom))] max-lg:max-h-[calc(100dvh-5.75rem-env(safe-area-inset-bottom))]";

  return (
    <div
      className={[
        "relative mx-auto flex max-w-[1400px] flex-col gap-3 sm:gap-4 sm:pb-10",
        "max-lg:-mx-3 max-lg:-mt-4 max-lg:mb-0 max-lg:min-h-0 max-lg:overflow-hidden max-lg:pb-0 max-lg:gap-0",
        mobileChatHeight,
      ].join(" ")}
    >
      <header className="hidden shrink-0 lg:block">
        <h1 className="text-xl font-semibold tracking-tight text-[#1e3348] sm:text-3xl">Чат</h1>
        <p className="mt-1 hidden text-sm text-[#5c6b7a] sm:block">
          Переписка с клиентами (WhatsApp через GREEN API): текст, фото, видео, голос, файлы.
        </p>
      </header>

      <div
        className={[
          "grid min-h-0 flex-1 gap-3 lg:min-h-[calc(100dvh-12rem)] lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-4",
          "max-lg:h-full max-lg:gap-0",
        ].join(" ")}
      >
        <section
          className={[
            "mo-card flex flex-col overflow-hidden p-3 max-lg:rounded-none max-lg:border-x-0 max-lg:p-2",
            mobileChatHeight,
            showListOnMobile ? "flex" : "hidden lg:flex",
          ].join(" ")}
        >
          <div className="mb-2 hidden text-sm font-semibold text-[#1e3348] sm:block">Диалоги</div>

          {showManagerChatBuckets ? (
            <div className="mb-2 grid shrink-0 grid-cols-2 gap-1 max-lg:mb-1.5 sm:mb-3 sm:grid-cols-4 sm:gap-1.5">
              {CHAT_BUCKET_TABS.map((tab) => {
                const active = chatBucket === tab.id;
                const count =
                  tab.id === "transferred"
                    ? bucketCountsQuery.data?.transferred ?? 0
                    : tab.id === "own"
                      ? bucketCountsQuery.data?.own ?? 0
                      : tab.id === "sold"
                        ? bucketCountsQuery.data?.sold ?? 0
                        : bucketCountsQuery.data?.awaiting_reply ?? 0;
                const activeShell =
                  tab.id === "transferred"
                    ? "border-[#c9b07a] bg-[#faf5eb] ring-1 ring-[#c9b07a]/40"
                    : tab.id === "own"
                      ? "border-[#2f5f85] bg-[#e8f0f7] ring-1 ring-[#2f5f85]/30"
                      : tab.id === "sold"
                        ? "border-[#7a5c9e] bg-[#f3edf8] ring-1 ring-[#7a5c9e]/35"
                        : "border-[#2d6a5a] bg-[#edf7f1] ring-1 ring-[#2d6a5a]/30";
                const idleShell = "border-[#d8d2c6] bg-white/80 hover:border-[#2f5f85]/30 hover:bg-white";
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setChatBucket(tab.id)}
                    className={[
                      "flex min-h-[52px] flex-col items-center justify-center rounded-lg border px-1 py-1.5 text-center transition sm:min-h-[72px] sm:rounded-xl sm:py-2",
                      active ? activeShell : idleShell,
                    ].join(" ")}
                  >
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-[#5c6b7a] sm:text-[10px]">
                      {tab.label}
                    </span>
                    <span className="mt-0.5 text-base font-bold tabular-nums text-[#1e3348] sm:text-xl">{count}</span>
                    <span className="mt-0.5 hidden text-[9px] leading-tight text-[#8a96a3] sm:block">{tab.hint}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <input
            value={threadSearch}
            onChange={(e) => setThreadSearch(e.target.value)}
            placeholder="Поиск: имя, телефон, чат, ключевое слово…"
            className="mb-1.5 w-full shrink-0 rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)] px-3 py-2 text-sm text-[var(--mo-text)] placeholder:mo-muted max-lg:py-1.5 sm:mb-2"
          />
          <p className="mb-2 hidden text-[10px] leading-relaxed mo-muted sm:block">
            {showManagerChatBuckets
              ? "Вкладки фильтруют список. Внутри вкладки: зелёный — ждёт ответа · голубой — первые 3 дня · без заливки — старше."
              : "Подсветка: зелёный — ждёт вашего ответа · голубой — первые 3 дня с первого сообщения · без заливки — старше."}
          </p>
          {threadsQuery.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}
          {threadsQuery.isError && (
            <p className="text-sm text-red-300">{(threadsQuery.error as Error).message}</p>
          )}
          <div
            ref={threadsListRef}
            className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain pr-1 sm:space-y-2 lg:max-h-[56vh]"
          >
            {displayThreads.map((t) => {
              const unread = t.unread_count ?? 0;
              const manager = (t.manager_name || "").trim();
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openThread(t)}
                  className={threadRowClasses(t, t.id === threadId)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--mo-text)]">
                      {t.lead_name || t.title || `Диалог #${t.id}`}
                    </div>
                    {threadPhoneForDisplay(t) !== "—" ? (
                      <div className="mt-0.5 truncate text-xs font-medium text-[var(--mo-text)]/90 tabular-nums max-lg:text-[11px] sm:mt-1">
                        <PatientPhone
                          value={{
                            phone: t.lead_phone,
                            phone_display: t.lead_phone_display || threadPhoneForDisplay(t),
                            phone_can_view_full: t.lead_phone_can_view_full,
                          }}
                        />
                      </div>
                    ) : null}
                    <div className="mt-0.5 truncate text-[10px] lux-caption max-lg:hidden">
                      {t.provider}
                    </div>
                    {saleSummaryLine(t) ? (
                      <div className="mt-1 truncate text-[10px] font-medium text-[#5a3d7a] sm:text-[11px]">
                        {saleSummaryLine(t)}
                      </div>
                    ) : null}
                    {manager ? (
                      <div className="mt-1 hidden truncate text-[11px] mo-muted/80 sm:block">
                        Ответственный: {manager}
                      </div>
                    ) : null}
                    {t.is_transferred && chatBucket !== "transferred" ? (
                      <div className="mt-0.5 text-[10px] text-amber-200/90">Передан вам</div>
                    ) : null}
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
            {!threadsQuery.isLoading && displayThreads.length === 0 && (
              <p className="text-sm mo-muted">
                {showManagerChatBuckets
                  ? chatBucket === "transferred"
                    ? "Нет переданных лидов"
                    : chatBucket === "own"
                      ? "Нет ваших диалогов"
                      : chatBucket === "sold"
                        ? "Нет проданных пациентов"
                        : "Нет диалогов, где ждут вашего ответа"
                  : "Пока нет диалогов"}
              </p>
            )}
            {threadsQuery.isFetchingNextPage && (
              <p className="py-1 text-center text-xs mo-muted">Загрузка ещё…</p>
            )}
            <div ref={threadsLoadMoreRef} className="h-1 w-full" aria-hidden />
          </div>
        </section>

        <section
          className={[
            "mo-section flex flex-col overflow-hidden p-3 shadow-inner backdrop-blur-sm sm:p-4",
            "max-lg:rounded-none max-lg:border-x-0 max-lg:p-2",
            threadId == null ? "hidden lg:flex" : "flex",
            threadId != null ? mobileChatHeight : "",
          ].join(" ")}
        >
          {threadId == null && (
            <p className="flex flex-1 items-center justify-center text-sm mo-muted lg:flex">
              Выберите диалог слева.
            </p>
          )}
          {threadId != null && (
            <>
              <div className="flex shrink-0 items-start gap-2 border-b border-[var(--mo-border)] pb-2 pt-0.5 max-lg:pb-1.5">
                <button
                  type="button"
                  className="btn-secondary shrink-0 px-2.5 py-1.5 text-sm max-lg:text-xs lg:hidden"
                  onClick={closeChat}
                  aria-label="Назад к списку диалогов"
                >
                  ← Назад
                </button>
                <div className="min-w-0 flex-1">
                  <div className="lux-subheading truncate text-sm sm:text-base">
                    {activeThread?.lead_name || activeThread?.title || `Диалог #${threadId}`}
                  </div>
                  {activeThread ? (
                    <>
                      <div className="mt-1 text-base font-semibold tracking-wide text-[var(--mo-text)] tabular-nums max-lg:text-sm">
                        {threadPhoneForDisplay(activeThread) !== "—" ? (
                          <PatientPhone
                            value={{
                              phone: activeThread.lead_phone,
                              phone_display:
                                activeThread.lead_phone_display || threadPhoneForDisplay(activeThread),
                              phone_can_view_full: activeThread.lead_phone_can_view_full,
                            }}
                          />
                        ) : (
                          <span className="text-xs font-normal lux-caption">Номер не указан</span>
                        )}
                      </div>
                      {saleSummaryLine(activeThread) ? (
                        <div className="mt-1 text-xs font-medium text-[#5a3d7a] sm:text-sm">
                          {saleSummaryLine(activeThread)}
                        </div>
                      ) : null}
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs lux-caption">
                        <span>{activeThread.provider}</span>
                        <span className="opacity-60">·</span>
                        <span>
                          Ответственный:{" "}
                          <span className="text-[var(--mo-text)]/90">{selectedManagerLabel}</span>
                        </span>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col">
              <div ref={messagesScrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-0.5 py-2 lg:max-h-[56vh]">
                {messagesQuery.isLoading && <p className="text-sm lux-caption">Загрузка сообщений…</p>}
                {(messagesQuery.data ?? []).map((m, idx, arr) => {
                  const isOut = m.direction === "out";
                  const time = formatChatTime(m.created_at);
                  const meta = isOut ? deliveryMeta(m.delivery_status) : null;
                  const isLastOut = isOut && arr.slice(idx + 1).every((x) => x.direction !== "out");

                  const metaToneClass =
                    meta?.tone === "seen"
                      ? "text-sky-200/95"
                      : meta?.tone === "good"
                        ? "text-emerald-200/90"
                        : meta?.tone === "bad"
                          ? "text-rose-200/95"
                          : "lux-caption";

                  return (
                    <div
                      key={m.id}
                      className={[
                        "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                        isOut
                          ? "ml-auto border border-[#2f5f85]/25 bg-[#e8f0f7] text-[var(--mo-text)]"
                          : "border border-[var(--mo-border)] bg-[var(--mo-surface)] text-[var(--mo-text)]",
                      ].join(" ")}
                    >
                      <MessageBody m={m} />
                      <div className="mt-1 flex items-center justify-end gap-2 text-[10px] tabular-nums lux-caption">
                        {time ? <span>{time}</span> : null}
                        {isOut && meta?.label ? <span className={metaToneClass}>{meta.label}</span> : null}
                      </div>
                      {isLastOut && isOut && meta?.label === "Просмотрено" && time ? (
                        <div className="mt-0.5 text-right text-[10px] tabular-nums text-sky-200/95">
                          {meta.label} · {time}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {!messagesQuery.isLoading && (messagesQuery.data ?? []).length === 0 && (
                  <p className="text-sm mo-muted">Нет сообщений.</p>
                )}
                <div ref={messagesEndRef} aria-hidden />
              </div>

              <form
                className="shrink-0 flex flex-col gap-2 border-t border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] pt-3 sm:flex-row sm:items-end lg:mt-3 lg:bg-transparent"
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
                  className="shrink-0 rounded-xl border border-[var(--mo-border-strong)] bg-[var(--mo-surface-elevated)] px-3 py-2 text-sm font-medium text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)] disabled:opacity-50"
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
                  className="mo-input min-w-0 flex-1 read-only:opacity-80"
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
                  className="btn-primary shrink-0 px-4 py-2 disabled:opacity-60"
                >
                  {voiceDraftFile ? "Отправить голосовое" : "Отправить"}
                </button>
              </form>
              {isRecording && (
                <p className="mt-1 text-xs font-medium text-red-300/90">● Запись… нажмите круглую кнопку ещё раз, чтобы остановить</p>
              )}
              {voiceFinishing && !isRecording && (
                <p className="mt-1 text-xs lux-caption">Отправка голосового…</p>
              )}
              {voiceDraftUrl && voiceDraftFile && !isRecording && !voiceFinishing && (
                <div className="mt-2 rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-3">
                  <div className="text-xs font-semibold text-[var(--mo-text)]">Предпрослушивание голосового</div>
                  <audio src={voiceDraftUrl} controls className="mt-2 w-full max-w-md" />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={sendVoiceDraft}
                      disabled={sendMutation.isPending}
                      className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-[var(--mo-text)] disabled:opacity-50"
                    >
                      Отправить
                    </button>
                    <button
                      type="button"
                      onClick={clearVoiceDraft}
                      disabled={sendMutation.isPending}
                      className="rounded-xl crm-modal-panel border/50 px-3 py-1.5 text-xs text-[var(--mo-text)] disabled:opacity-50"
                    >
                      Отменить
                    </button>
                  </div>
                </div>
              )}
              {pendingFile && !isRecording && (
                <p className="mt-1 text-xs lux-caption">Вложение: {pendingFile.name}</p>
              )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
