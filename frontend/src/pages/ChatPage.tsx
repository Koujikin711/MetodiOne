import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { PatientPhone, displayPatientPhone } from "@/components/PatientPhone";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useChatRealtime } from "@/hooks/useChatRealtime";
import { useCurrentUserMe } from "@/hooks/useCurrentUserMe";
import { apiFetch, getActiveCompanyId, getStoredToken, resolveApiUrl, resolveMediaUrl } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { formatMoney, formatCompactCount } from "@/lib/money";
import type {
  ChatMessage,
  ChatThread,
  ChatThreadBucket,
  ChatThreadBucketCounts,
  PipelineStage,
  SalesStageKey,
} from "@/lib/types";

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

/** Не показываем техническое имя интеграции в списке диалогов. */
function threadProviderLabel(provider: string | null | undefined): string | null {
  const raw = (provider || "").trim();
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/\s+/g, "_");
  if (key === "green_api") return null;
  return raw;
}

function isHiddenIntegrationLabel(value: string | null | undefined): boolean {
  const key = (value || "").trim().toLowerCase().replace(/\s+/g, "_");
  return key === "green_api";
}

function threadDisplayTitle(t: ChatThread): string {
  const name = (t.lead_name || "").trim();
  if (name) return name;
  const title = (t.title || "").trim();
  if (title && !isHiddenIntegrationLabel(title)) return title;
  return `Диалог #${t.id}`;
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif)(\?|#|$)/i;

function localDateKey(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatChatDateSeparator(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const msgKey = localDateKey(raw);
  const todayKey = localDateKey(now.toISOString());
  if (msgKey === todayKey) return "Сегодня";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (msgKey === localDateKey(yesterday.toISOString())) return "Вчера";
  try {
    const opts: Intl.DateTimeFormatOptions =
      d.getFullYear() === now.getFullYear()
        ? { day: "numeric", month: "long" }
        : { day: "numeric", month: "long", year: "numeric" };
    return new Intl.DateTimeFormat("ru-RU", opts).format(d);
  } catch {
    return d.toLocaleDateString("ru-RU");
  }
}

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
  // «Отправлено» / «Отправка…» не показываем — достаточно времени
  if (s === "sent" || s === "sending") return { label: "", tone: "neutral" };
  if (s === "failed" || s === "error") return { label: "Не отправлено", tone: "bad" };
  return { label: statusRaw || "", tone: "neutral" };
}

function looksLikeImageAttachment(m: ChatMessage): boolean {
  if ((m.message_type ?? "text") === "image") return true;
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

const AUDIO_EXT_RE = /\.(ogg|opus|mp3|m4a|aac|amr|webm|wav)(\?|#|$)/i;

function looksLikeAudioAttachment(m: ChatMessage): boolean {
  const mime = (m.media_mime || "").toLowerCase().split(";")[0].trim();
  if (mime.startsWith("audio/")) return true;
  const name = (m.file_name || "").trim();
  if (name && AUDIO_EXT_RE.test(name)) return true;
  const raw = (m.media_url || "").trim();
  if (raw) {
    try {
      const path = new URL(raw, "https://example.com").pathname;
      if (AUDIO_EXT_RE.test(path)) return true;
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

function isProtectedApiMediaUrl(url: string | null | undefined): boolean {
  const u = (url || "").trim();
  if (!u) return true;
  if (u.startsWith("/api/chat/messages/")) return true;
  try {
    const path = new URL(u, "https://example.com").pathname;
    return /^\/api\/chat\/messages\/\d+\/media\/?$/i.test(path);
  } catch {
    return false;
  }
}

function useProtectedMediaSrc(message: ChatMessage, enabled: boolean): {
  src: string | null;
  loading: boolean;
  failed: boolean;
} {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setSrc(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    const external = (message.media_url || "").trim();
    if (
      external &&
      /^https?:\/\//i.test(external) &&
      !external.toLowerCase().includes("downloadfile") &&
      !isProtectedApiMediaUrl(external)
    ) {
      setSrc(external);
      setLoading(false);
      setFailed(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    const path = `/api/chat/messages/${message.id}/media`;

    setLoading(true);
    setFailed(false);
    setSrc(null);

    void (async () => {
      try {
        const headers = new Headers();
        const token = getStoredToken();
        if (token) headers.set("Authorization", `Bearer ${token}`);
        const companyId = getActiveCompanyId();
        if (companyId != null) headers.set("X-Company-Id", String(companyId));
        const res = await fetch(resolveApiUrl(path), { headers });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setSrc(objectUrl);
          setFailed(false);
        }
      } catch {
        if (!cancelled) {
          setSrc(null);
          setFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [message.id, message.media_url, enabled]);

  return { src, loading, failed };
}

function MessageBody({ m }: { m: ChatMessage }) {
  const mt = m.message_type ?? "text";
  const showAsAudio = mt === "audio" || looksLikeAudioAttachment(m);
  const hasMedia = mt !== "text" || Boolean((m.media_url || "").trim());
  const rawMedia = (m.media_url || "").trim();
  const needsProtectedFetch =
    hasMedia &&
    (isProtectedApiMediaUrl(rawMedia) || !/^https?:\/\//i.test(rawMedia) || rawMedia.toLowerCase().includes("downloadfile"));
  const { src: protectedSrc, loading: mediaLoading, failed: mediaFailed } = useProtectedMediaSrc(
    m,
    needsProtectedFetch,
  );
  const directUrl =
    !needsProtectedFetch && rawMedia && /^https?:\/\//i.test(rawMedia) ? resolveMediaUrl(rawMedia) : null;
  const url = protectedSrc ?? directUrl;
  const showAsImage =
    !showAsAudio &&
    mt !== "video" &&
    mt !== "audio" &&
    (mt === "image" || looksLikeImageAttachment(m));

  if (showAsImage) {
    const cap = imageCaptionToShow(m);
    if (url) {
      return (
        <div className="space-y-2">
          <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg">
            <img src={url} alt="" className="max-h-64 w-full object-contain" />
          </a>
          {cap ? <div>{cap}</div> : null}
        </div>
      );
    }
    if (mediaLoading) {
      return (
        <div className="space-y-2">
          <div className="flex h-32 max-w-xs items-center justify-center rounded-lg bg-[var(--mo-surface-elevated)] text-xs lux-caption">
            Загрузка фото…
          </div>
          {cap ? <div>{cap}</div> : null}
        </div>
      );
    }
    if (mediaFailed || m.text) {
      return (
        <div className="space-y-1">
          <div className="text-sm">{m.text || "📷 Фото"}</div>
          {mediaFailed ? (
            <div className="text-[11px] lux-caption">Файл не найден — нажмите «Догрузить медиа» вверху чата</div>
          ) : null}
        </div>
      );
    }
    return <div>{m.text || "📷 Фото"}</div>;
  }

  if (mt === "video" && url) {
    return (
      <div className="space-y-2">
        <video src={url} controls className="max-h-64 w-full rounded-lg" />
        {m.text && m.text !== "🎬 Видео" && <div>{m.text}</div>}
      </div>
    );
  }

  if (showAsAudio && url) {
    return (
      <div className="space-y-2">
        <audio src={url} controls className="w-full max-w-sm" preload="metadata" />
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
          {m.file_name || "📎"}
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

function SendPlaneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        fill="currentColor"
        d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.993.993 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"
      />
    </svg>
  );
}

function PaperclipIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.44 11.05l-8.49 8.49a5.25 5.25 0 01-7.42-7.42l8.84-8.84a3.5 3.5 0 014.95 4.95l-8.84 8.84a1.75 1.75 0 01-2.47-2.47l7.78-7.78"
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

/** Reply-очередь менеджера (новые лиды — в общем списке, без отдельной вкладки стадии). */
const REPLY_QUEUE_TABS: { id: ChatThreadBucket; label: string; hint: string }[] = [
  { id: "awaiting_reply", label: "Ждут ответа", hint: "Клиент написал — вы нет" },
  { id: "no_reply", label: "Не ответили", hint: "Вы написали — клиент молчит" },
];

/** Без «Новый лид» и «Архив» — они только в списке диалогов / авто. */
const SALES_STAGE_TABS: { id: SalesStageKey; label: string; hint: string; color: string }[] = [
  { id: "in_progress", label: "В работе", hint: "Ответил менеджер", color: "#0ea5e9" },
  { id: "waiting", label: "Ожидание", hint: "Ждём оплату / клиента", color: "#f59e0b" },
  { id: "won", label: "Удачно", hint: "Продано / записано", color: "#22c55e" },
  { id: "lost", label: "Отказ", hint: "Отказ клиента", color: "#ef4444" },
];

const SALES_STAGE_COLORS: Record<SalesStageKey, string> = {
  new: "#64748b",
  in_progress: "#0ea5e9",
  waiting: "#f59e0b",
  won: "#22c55e",
  lost: "#ef4444",
  archive: "#78716c",
};

function stageColorForThread(t: Pick<ChatThread, "lead_stage_key" | "lead_stage_name">): string {
  if (t.lead_stage_key && SALES_STAGE_COLORS[t.lead_stage_key]) {
    return SALES_STAGE_COLORS[t.lead_stage_key];
  }
  const n = (t.lead_stage_name || "").trim().toLowerCase();
  if (n.includes("нов")) return SALES_STAGE_COLORS.new;
  if (n.includes("обработ") || n.includes("работ")) return SALES_STAGE_COLORS.in_progress;
  if (n.includes("ожид")) return SALES_STAGE_COLORS.waiting;
  if (n.includes("удач") || n.includes("успеш")) return SALES_STAGE_COLORS.won;
  if (n.includes("отказ") || n.includes("потеря")) return SALES_STAGE_COLORS.lost;
  if (n.includes("архив")) return SALES_STAGE_COLORS.archive;
  return "var(--mo-text)";
}

function stageLabelForDisplay(name: string | null | undefined): string {
  const raw = (name || "").trim();
  if (raw === "В обработке") return "В работе";
  return raw;
}

function formatSaleMoney(raw: string | null | undefined): string {
  if (!raw) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return formatMoney(n, { digits: 0 });
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
    "chat-thread-row flex w-full items-start gap-2.5 rounded-2xl border px-3.5 py-2.5 text-left transition max-lg:px-3 max-lg:py-2";
  if (selected) return [base, "chat-thread-row--selected"].join(" ");
  const attn = threadAttention(t);
  if (attn === "waiting_reply") return [base, "chat-thread-row--waiting"].join(" ");
  if (attn === "recent_window") return [base, "chat-thread-row--recent"].join(" ");
  return [base, "chat-thread-row--default"].join(" ");
}

export function ChatPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
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
  const meQuery = useCurrentUserMe();
  const salesChatMode = meQuery.data?.chat_stages_enabled !== false;
  const showManagerChatBuckets =
    userRole === "manager" || userRole === "admin" || userRole === "owner";
  const stageTabs = SALES_STAGE_TABS;
  const [chatBucket, setChatBucket] = useState<ChatThreadBucket>("own");
  /** null = все стадии, включая «Новый лид» в списке */
  const [salesStageKey, setSalesStageKey] = useState<SalesStageKey | null>(null);
  /** Ждут ответа / Не ответили — поверх стадий для менеджера. */
  const [replyQueue, setReplyQueue] = useState<ChatThreadBucket>("awaiting_reply");
  const [statusOpen, setStatusOpen] = useState(false);

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
    queryKey: [
      "chat-threads",
      threadSearchDebounced,
      salesChatMode
        ? `stage:${salesStageKey ?? "all"}|reply:${replyQueue}`
        : showManagerChatBuckets
          ? chatBucket
          : "all",
    ],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      if (threadSearchDebounced) p.set("q", threadSearchDebounced);
      if (showManagerChatBuckets) {
        if (salesChatMode) {
          if (salesStageKey) p.set("stage_key", salesStageKey);
          p.set("bucket", replyQueue);
        } else {
          p.set("bucket", chatBucket);
        }
      }
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
  const leadFromQueryValid = Number.isFinite(leadFromQuery) && leadFromQuery > 0;

  const threadByLeadQuery = useQuery({
    queryKey: ["chat-thread-by-lead", leadFromQuery],
    queryFn: () => apiFetch<ChatThread>(`/api/chat/threads/by-lead/${leadFromQuery}`),
    enabled: leadFromQueryValid && threadId == null,
    retry: false,
  });

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
    if (!leadFromQueryValid || threadId != null) return;
    if (threadByLeadQuery.data) {
      openThread(threadByLeadQuery.data);
      return;
    }
    const match = allThreads.find((t) => t.lead_id === leadFromQuery);
    if (match) openThread(match);
  }, [leadFromQueryValid, leadFromQuery, threadId, threadByLeadQuery.data, allThreads]);

  useEffect(() => {
    if (!threadByLeadQuery.isError) return;
    const msg = (threadByLeadQuery.error as Error).message || "Чат не найден";
    toast.error(msg, { id: `chat-lead-${leadFromQuery}` });
  }, [threadByLeadQuery.isError, threadByLeadQuery.error, leadFromQuery]);

  function openThread(t: ChatThread) {
    setThreadId(t.id);
    setPinnedThread(t);
  }

  function closeChat() {
    setThreadId(null);
    setPinnedThread(null);
    setStatusOpen(false);
  }

  const [text, setText] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
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

  const canSendMessage = Boolean(text.trim() || pendingFile || voiceDraftFile);
  const hideMobileBottomNav = composerFocused || canSendMessage || isRecording || voiceFinishing;

  useEffect(() => {
    const root = document.documentElement;
    if (hideMobileBottomNav) root.setAttribute("data-chat-composing", "1");
    else root.removeAttribute("data-chat-composing");
    return () => root.removeAttribute("data-chat-composing");
  }, [hideMobileBottomNav]);

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

  const prevChatBucketRef = useRef(chatBucket);
  useEffect(() => {
    if (!showManagerChatBuckets) return;
    if (prevChatBucketRef.current === chatBucket) return;
    prevChatBucketRef.current = chatBucket;
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

  const statusStagesPipelineId = activeThread?.pipeline_id ?? null;
  const statusStagesQuery = useQuery({
    queryKey: ["stages", statusStagesPipelineId, "chat-status"],
    queryFn: () =>
      apiFetch<PipelineStage[]>(
        statusStagesPipelineId
          ? `/api/stages?pipeline_id=${statusStagesPipelineId}`
          : "/api/stages",
      ),
    enabled: Boolean(salesChatMode && statusOpen && statusStagesPipelineId),
  });

  const setLeadStatusMutation = useMutation({
    mutationFn: async ({
      leadId,
      statusId,
      stageName,
    }: {
      leadId: number;
      statusId: number;
      stageName: string;
    }) => {
      await apiFetch(`/api/leads/${leadId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status_id: statusId, assign_to_me: true }),
      });
      return { leadId, stageName };
    },
    onSuccess: ({ leadId, stageName }) => {
      toast.success("Статус обновлён");
      setStatusOpen(false);
      void qc.invalidateQueries({ queryKey: ["chat-threads"] });
      void qc.invalidateQueries({ queryKey: ["chat-thread-bucket-counts"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      if (salesChatMode && stageName.trim() === "Удачно") {
        toast.success("Открываем онлайн-запись — выберите эксперта, дату и сумму");
        navigate(`/booking?lead_id=${leadId}`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const repairMediaMutation = useMutation({
    mutationFn: async () => {
      if (threadId == null) throw new Error("Нет диалога");
      return apiFetch<{ checked: number; repaired: number; failed: number }>(
        `/api/chat/threads/${threadId}/repair-media`,
        { method: "POST" },
      );
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["chat-messages", threadId] });
      if (data.repaired > 0) {
        toast.success(`Догружено медиа: ${data.repaired}`);
      } else if (data.failed > 0) {
        toast.error(`Не удалось догрузить: ${data.failed} (ссылки Green API могли истечь)`);
      } else {
        toast.success("Все медиа уже на сервере");
      }
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
        "relative mx-auto flex h-full w-full max-w-none flex-col gap-2 sm:gap-3 lg:min-h-0 lg:flex-1 lg:gap-3 lg:overflow-hidden",
        "max-lg:-mx-3 max-lg:-mt-4 max-lg:mb-0 max-lg:min-h-0 max-lg:overflow-hidden max-lg:pb-0 max-lg:gap-0",
        mobileChatHeight,
      ].join(" ")}
    >
      <header className="hidden shrink-0 lg:block">
        <h1 className="lux-heading-page text-xl sm:text-2xl">Чат</h1>
        <p className="mt-0.5 hidden text-sm lux-caption xl:block">
          Переписка с клиентами: текст, фото, видео, голос, файлы.
        </p>
      </header>

      <div
        className={[
          "grid min-h-0 flex-1 gap-3 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(320px,360px)_minmax(0,1fr)] lg:gap-3 lg:overflow-hidden",
          "max-lg:h-full max-lg:gap-0",
        ].join(" ")}
      >
        <section
          className={[
            "mo-card chat-dialogs-rail flex min-h-0 flex-col overflow-hidden p-3 max-lg:rounded-none max-lg:border-x-0 max-lg:p-2.5 lg:h-full lg:min-w-[320px] lg:max-w-[360px] lg:shrink-0",
            mobileChatHeight,
            showListOnMobile ? "flex" : "hidden lg:flex",
          ].join(" ")}
        >
          <div className="mb-2.5 hidden text-base font-semibold tracking-tight text-[var(--mo-text)] sm:block">
            Диалоги
          </div>

          {showManagerChatBuckets ? (
            <div className="mb-2.5 shrink-0 max-lg:mb-2 sm:mb-3">
              <div
                className={[
                  "no-scrollbar -mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 pb-0.5",
                  "sm:mx-0 sm:grid sm:gap-2 sm:overflow-visible sm:px-0 sm:pb-0",
                  salesChatMode ? "sm:grid-cols-2" : "sm:grid-cols-2",
                ].join(" ")}
              >
                {(salesChatMode ? stageTabs : CHAT_BUCKET_TABS).map((tab) => {
                  const active = salesChatMode
                    ? salesStageKey === tab.id
                    : chatBucket === (tab.id as ChatThreadBucket);
                  const count = salesChatMode
                    ? bucketCountsQuery.data?.sales_stages?.[tab.id as SalesStageKey] ?? 0
                    : tab.id === "transferred"
                      ? bucketCountsQuery.data?.transferred ?? 0
                      : tab.id === "own"
                        ? bucketCountsQuery.data?.own ?? 0
                        : tab.id === "sold"
                          ? bucketCountsQuery.data?.sold ?? 0
                          : bucketCountsQuery.data?.awaiting_reply ?? 0;
                  const stageColor =
                    salesChatMode && "color" in tab ? (tab as { color: string }).color : undefined;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      data-bucket={tab.id}
                      title={
                        salesChatMode
                          ? active
                            ? `${tab.hint} · нажмите ещё раз, чтобы снять фильтр`
                            : tab.hint
                          : tab.hint
                      }
                      onClick={() => {
                        if (salesChatMode) {
                          setSalesStageKey((prev) =>
                            prev === (tab.id as SalesStageKey) ? null : (tab.id as SalesStageKey),
                          );
                        } else {
                          setChatBucket(tab.id as ChatThreadBucket);
                        }
                      }}
                      className={[
                        "chat-bucket-tab flex min-w-[5.5rem] shrink-0 flex-col items-center justify-center rounded-2xl border px-2.5 py-2.5 text-center transition sm:min-h-[4.75rem] sm:min-w-0",
                        active ? "is-active" : "",
                      ].join(" ")}
                      style={
                        stageColor
                          ? ({
                              ["--chat-stage-color" as string]: stageColor,
                            } as CSSProperties)
                          : undefined
                      }
                    >
                      <span className="max-w-full text-[11px] font-semibold leading-tight tracking-wide text-[var(--mo-text-muted)] sm:text-xs">
                        {tab.label}
                      </span>
                      <span
                        className="mt-1.5 text-xl font-bold tabular-nums leading-none text-[var(--mo-text)] sm:text-2xl"
                        title={String(count)}
                      >
                        {formatCompactCount(count)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {showManagerChatBuckets && salesChatMode ? (
            <div className="chat-reply-queue mb-2.5 grid shrink-0 grid-cols-2 gap-2 max-lg:mb-2 sm:mb-3">
              {REPLY_QUEUE_TABS.map((tab) => {
                const active = replyQueue === tab.id;
                const count =
                  tab.id === "awaiting_reply"
                    ? bucketCountsQuery.data?.awaiting_reply ?? 0
                    : bucketCountsQuery.data?.no_reply ?? 0;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    data-reply-queue={tab.id}
                    data-bucket={tab.id}
                    title={tab.hint}
                    onClick={() => setReplyQueue(tab.id)}
                    className={[
                      "chat-bucket-tab chat-reply-tab flex min-h-[3.75rem] flex-col items-center justify-center rounded-2xl border px-2.5 py-2.5 text-center transition sm:min-h-[4.25rem]",
                      active ? "is-active" : "",
                    ].join(" ")}
                  >
                    <span className="max-w-full text-[11px] font-semibold leading-tight tracking-wide text-[var(--mo-text-muted)] sm:text-xs">
                      {tab.label}
                    </span>
                    <span
                      className="mt-1.5 text-lg font-bold tabular-nums leading-none text-[var(--mo-text)] sm:text-xl"
                      title={String(count)}
                    >
                      {formatCompactCount(count)}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <input
            value={threadSearch}
            onChange={(e) => setThreadSearch(e.target.value)}
            placeholder="Поиск: имя, телефон, чат…"
            className="mb-2 w-full shrink-0 rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)] px-3.5 py-2.5 text-sm text-[var(--mo-text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] placeholder:mo-muted max-lg:py-2"
          />
          <p className="mb-2 hidden text-[11px] leading-snug mo-muted lg:block">
            {showManagerChatBuckets && salesChatMode
              ? "Зелёный в списке — ждёт ответа. Повторный клик по стадии снимает фильтр."
              : showManagerChatBuckets
                ? "Зелёный — ждёт ответа · голубой — первые 3 дня."
                : "Зелёный — ждёт ответа · голубой — первые 3 дня."}
          </p>
          {threadsQuery.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}
          {threadsQuery.isError && (
            <p className="text-sm text-red-300">{(threadsQuery.error as Error).message}</p>
          )}
          <div
            ref={threadsListRef}
            className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1 sm:space-y-2.5"
          >
            {displayThreads.map((t) => {
              const unread = t.unread_count ?? 0;
              const manager = (t.manager_name || "").trim();
              const providerLabel = threadProviderLabel(t.provider);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openThread(t)}
                  className={threadRowClasses(t, t.id === threadId)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--mo-text)]">
                      {threadDisplayTitle(t)}
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
                    {providerLabel ? (
                      <div className="mt-0.5 truncate text-[10px] lux-caption max-lg:hidden">
                        {providerLabel}
                      </div>
                    ) : null}
                    {saleSummaryLine(t) ? (
                      <div className="mt-1 truncate text-[10px] font-medium text-[#5a3d7a] sm:text-[11px]">
                        {saleSummaryLine(t)}
                      </div>
                    ) : null}
                    {t.lead_stage_name ? (
                      <div className="mt-1 truncate text-[11px] mo-muted">
                        Стадия:{" "}
                        <span className="font-semibold" style={{ color: stageColorForThread(t) }}>
                          {stageLabelForDisplay(t.lead_stage_name)}
                        </span>
                      </div>
                    ) : null}
                    {manager ? (
                      <div className="mt-0.5 truncate text-[11px] mo-muted/80">
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
                  ? salesChatMode
                    ? `Нет диалогов${
                        salesStageKey
                          ? ` в «${stageTabs.find((t) => t.id === salesStageKey)?.label ?? salesStageKey}»`
                          : ""
                      }${
                        replyQueue === "awaiting_reply"
                          ? " · Ждут ответа"
                          : replyQueue === "no_reply"
                            ? " · Не ответили"
                            : ""
                      }`
                    : chatBucket === "transferred"
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
            "mo-section flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-3 shadow-inner backdrop-blur-sm sm:p-4 lg:h-full",
            "max-lg:rounded-none max-lg:border-x-0 max-lg:p-2",
            threadId == null ? "hidden lg:flex" : "flex",
            mobileChatHeight,
          ].join(" ")}
        >
          {threadId == null && (
            <p className="flex flex-1 items-center justify-center text-sm mo-muted lg:flex">
              Выберите диалог слева.
            </p>
          )}
          {threadId != null && (
            <>
              <div className="chat-thread-header flex shrink-0 items-center gap-1.5 border-b border-[var(--mo-border)] pb-2 pt-0.5 max-lg:gap-1 max-lg:pb-1.5">
                <button
                  type="button"
                  className="chat-thread-header-btn chat-thread-header-btn--back lg:hidden"
                  onClick={closeChat}
                  aria-label="Назад к списку диалогов"
                >
                  <span aria-hidden>←</span>
                  <span className="max-lg:hidden">Назад</span>
                </button>
                <div className="min-w-0 flex-1">
                  <div className="lux-subheading truncate text-sm sm:text-base">
                    {activeThread ? threadDisplayTitle(activeThread) : `Диалог #${threadId}`}
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
                      {activeThread.lead_stage_name ? (
                        <div className="mt-1 text-[11px] mo-muted sm:text-xs">
                          Стадия:{" "}
                          <span
                            className="font-semibold"
                            style={{ color: stageColorForThread(activeThread) }}
                          >
                            {stageLabelForDisplay(activeThread.lead_stage_name)}
                          </span>
                        </div>
                      ) : null}
                      {saleSummaryLine(activeThread) ? (
                        <div className="mt-1 text-xs font-medium text-[#5a3d7a] sm:text-sm">
                          {saleSummaryLine(activeThread)}
                        </div>
                      ) : null}
                      {(() => {
                        const providerLabel = threadProviderLabel(activeThread.provider);
                        if (!providerLabel && !selectedManagerLabel) return null;
                        return (
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs lux-caption">
                            {providerLabel ? <span>{providerLabel}</span> : null}
                            {providerLabel && selectedManagerLabel ? <span className="opacity-60">·</span> : null}
                            {selectedManagerLabel ? (
                              <span>
                                Ответственный:{" "}
                                <span className="text-[var(--mo-text)]/90">{selectedManagerLabel}</span>
                              </span>
                            ) : null}
                          </div>
                        );
                      })()}
                    </>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {salesChatMode && activeThread?.lead_id ? (
                    <button
                      type="button"
                      className="chat-thread-header-btn shrink-0"
                      onClick={() => setStatusOpen((v) => !v)}
                      title="Сменить стадию и взять лид на себя"
                    >
                      Статус
                    </button>
                  ) : null}
                  <div className="lg:hidden">
                    <ThemeToggle compact />
                  </div>
                  <button
                    type="button"
                    className="chat-thread-header-btn shrink-0"
                    disabled={repairMediaMutation.isPending}
                    onClick={() => repairMediaMutation.mutate()}
                    title="Догрузить голосовые и фото, если не отображаются"
                  >
                    <span className="lg:hidden">
                      {repairMediaMutation.isPending ? "…" : "Медиа"}
                    </span>
                    <span className="hidden lg:inline">
                      {repairMediaMutation.isPending ? "Догрузка…" : "Догрузить медиа"}
                    </span>
                  </button>
                </div>
              </div>

              {statusOpen && salesChatMode && activeThread?.lead_id ? (
                <div className="shrink-0 border-b border-[var(--mo-border)] py-2">
                  <p className="mb-1.5 text-[11px] mo-muted">
                    Вручную: В работе / В ожидании / Удачно / Отказ. «Новый лид» — автоматически
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(statusStagesQuery.data ?? [])
                      .slice()
                      .filter((s) => {
                        const n = s.name.trim();
                        return (
                          n === "В обработке" ||
                          n === "В работе" ||
                          n === "В ожидании" ||
                          n === "Удачно" ||
                          n === "Отказ"
                        );
                      })
                      .sort((a, b) => a.order - b.order || a.id - b.id)
                      .map((s) => {
                        const current = activeThread.lead_status_id === s.id;
                        const label = s.name.trim() === "В обработке" ? "В работе" : s.name;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            disabled={setLeadStatusMutation.isPending || current}
                            onClick={() =>
                              setLeadStatusMutation.mutate({
                                leadId: Number(activeThread.lead_id),
                                statusId: s.id,
                                stageName: s.name,
                              })
                            }
                            className={[
                              "rounded-lg border px-2.5 py-1.5 text-xs transition",
                              current
                                ? "border-[var(--mo-accent)] bg-[var(--mo-accent-soft)] font-semibold text-[var(--mo-text)]"
                                : "border-[var(--mo-border)] text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)] disabled:opacity-50",
                            ].join(" ")}
                            style={{ borderLeftWidth: 3, borderLeftColor: s.color }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    {statusStagesQuery.isLoading ? (
                      <span className="text-xs mo-muted">Загрузка стадий…</span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="flex min-h-0 flex-1 flex-col">
              <div ref={messagesScrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-0.5 py-2">
                {messagesQuery.isLoading && <p className="text-sm lux-caption">Загрузка сообщений…</p>}
                {(messagesQuery.data ?? []).map((m, idx, arr) => {
                  const isOut = m.direction === "out";
                  const time = formatChatTime(m.created_at);
                  const meta = isOut ? deliveryMeta(m.delivery_status) : null;
                  const isLastOut = isOut && arr.slice(idx + 1).every((x) => x.direction !== "out");
                  const dayKey = localDateKey(m.created_at);
                  const prevDayKey = idx > 0 ? localDateKey(arr[idx - 1]?.created_at) : "";
                  const showDateSep = !!dayKey && dayKey !== prevDayKey;

                  const metaToneClass =
                    meta?.tone === "seen"
                      ? "text-sky-200/95"
                      : meta?.tone === "good"
                        ? "text-emerald-200/90"
                        : meta?.tone === "bad"
                          ? "text-rose-200/95"
                          : "lux-caption";

                  return (
                    <Fragment key={m.id}>
                      {showDateSep ? (
                        <div className="flex justify-center py-2">
                          <span className="rounded-lg bg-[var(--mo-surface-elevated)] px-3 py-1 text-[11px] font-medium shadow-sm ring-1 ring-[var(--mo-border)] lux-caption">
                            {formatChatDateSeparator(m.created_at)}
                          </span>
                        </div>
                      ) : null}
                      <div
                        className={[
                          "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                          isOut ? "chat-msg-out" : "chat-msg-in",
                        ].join(" ")}
                      >
                        <MessageBody m={m} />
                        <div className="mt-1 flex items-center justify-end gap-2 text-[10px] tabular-nums lux-caption">
                          {time ? (
                            <span title={formatChatDateSeparator(m.created_at)}>{time}</span>
                          ) : null}
                          {isOut && meta?.label ? <span className={metaToneClass}>{meta.label}</span> : null}
                        </div>
                        {isLastOut && isOut && meta?.label === "Просмотрено" && time ? (
                          <div className="mt-0.5 text-right text-[10px] tabular-nums text-sky-200/95">
                            {meta.label} · {time}
                          </div>
                        ) : null}
                      </div>
                    </Fragment>
                  );
                })}
                {!messagesQuery.isLoading && (messagesQuery.data ?? []).length === 0 && (
                  <p className="text-sm mo-muted">Нет сообщений.</p>
                )}
                <div ref={messagesEndRef} aria-hidden />
              </div>

              <form
                className="chat-composer shrink-0 border-t border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] pt-2.5 pb-[max(0.35rem,env(safe-area-inset-bottom))] lg:rounded-2xl lg:border lg:bg-[var(--mo-surface-elevated)] lg:p-3 lg:pb-3"
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
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isRecording || voiceFinishing || sendMutation.isPending}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--mo-border)] bg-[var(--mo-surface)] text-[var(--mo-text)] shadow-sm transition hover:bg-[var(--mo-accent-soft)] disabled:opacity-50"
                    title="Прикрепить файл"
                    aria-label="Прикрепить файл"
                  >
                    <PaperclipIcon className="h-5 w-5" />
                  </button>
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onFocus={() => setComposerFocused(true)}
                    onBlur={() => setComposerFocused(false)}
                    placeholder={
                      voiceFinishing
                        ? "Отправка голосового…"
                        : isRecording
                          ? "Идёт запись… нажмите ещё раз, чтобы отправить"
                          : voiceDraftFile
                            ? "Голосовое готово — прослушайте и отправьте"
                          : pendingFile
                            ? "Подпись (необязательно)…"
                            : "Сообщение клиенту…"
                    }
                    readOnly={isRecording || voiceFinishing}
                    className="mo-input min-w-0 flex-1 rounded-full py-2.5 read-only:opacity-80"
                  />
                  {canSendMessage && !isRecording ? (
                    <button
                      type="submit"
                      disabled={sendMutation.isPending || voiceFinishing}
                      title={voiceDraftFile ? "Отправить голосовое" : "Отправить"}
                      aria-label="Отправить"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--mo-accent)] text-white shadow-md transition hover:bg-[var(--mo-accent-hover)] disabled:opacity-50"
                    >
                      <SendPlaneIcon className="h-5 w-5 translate-x-px -translate-y-px" />
                    </button>
                  ) : (
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
                  )}
                </div>
                {canSendMessage && !isRecording ? (
                  <button
                    type="submit"
                    disabled={sendMutation.isPending || voiceFinishing}
                    className="btn-primary mt-2 w-full px-4 py-2.5 disabled:opacity-60 lg:hidden"
                  >
                    {voiceDraftFile ? "Отправить голосовое" : "Отправить"}
                  </button>
                ) : null}
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
