import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeUserIdFromToken } from "@/lib/auth";
import { useChatRealtime } from "@/hooks/useChatRealtime";

type TeamContact = {
  id: number;
  full_name: string | null;
  email: string;
  role: string;
  display_name: string;
};

type TeamThread = {
  id: number;
  peer_user_id: number;
  peer_name: string;
  peer_role: string;
  unread_count: number;
  last_message_text: string | null;
  last_message_at: string | null;
};

type TeamMessage = {
  id: number;
  thread_id: number;
  author_user_id: number | null;
  text: string;
  created_at: string;
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Владелец",
  admin: "Администратор",
  manager: "Менеджер",
  expert: "Эксперт",
  finance_analyst: "Финансы",
};

function formatTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (sameDay) {
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function roleLabel(role: string) {
  return ROLE_LABEL[role] ?? role;
}

export function TeamMessengerPage() {
  const queryClient = useQueryClient();
  const myId = decodeUserIdFromToken(getStoredToken());
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useChatRealtime(true);

  const contactsQ = useQuery({
    queryKey: ["team-contacts", contactSearch],
    queryFn: () => {
      const p = contactSearch.trim() ? `?q=${encodeURIComponent(contactSearch.trim())}` : "";
      return apiFetch<TeamContact[]>(`/api/team-chat/contacts${p}`);
    },
  });

  const threadsQ = useQuery({
    queryKey: ["team-threads"],
    queryFn: () => apiFetch<TeamThread[]>("/api/team-chat/threads"),
    refetchInterval: 15_000,
  });

  const messagesQ = useQuery({
    queryKey: ["team-messages", activeThreadId],
    queryFn: () => apiFetch<TeamMessage[]>(`/api/team-chat/threads/${activeThreadId}/messages`),
    enabled: activeThreadId != null,
    refetchInterval: 8_000,
  });

  const activeThread = useMemo(
    () => (threadsQ.data ?? []).find((t) => t.id === activeThreadId) ?? null,
    [threadsQ.data, activeThreadId],
  );

  const openThreadMutation = useMutation({
    mutationFn: (peerUserId: number) =>
      apiFetch<TeamThread>("/api/team-chat/threads", {
        method: "POST",
        body: JSON.stringify({ peer_user_id: peerUserId }),
      }),
    onSuccess: (thread) => {
      setActiveThreadId(thread.id);
      void queryClient.invalidateQueries({ queryKey: ["team-threads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendMutation = useMutation({
    mutationFn: (text: string) =>
      apiFetch<TeamMessage>(`/api/team-chat/threads/${activeThreadId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => {
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: ["team-messages", activeThreadId] });
      void queryClient.invalidateQueries({ queryKey: ["team-threads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeChat = () => setActiveThreadId(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQ.data, activeThreadId]);

  useEffect(() => {
    const handler = () => {
      void queryClient.invalidateQueries({ queryKey: ["team-threads"] });
      if (activeThreadId != null) {
        void queryClient.invalidateQueries({ queryKey: ["team-messages", activeThreadId] });
      }
    };
    const id = window.setInterval(handler, 12_000);
    return () => window.clearInterval(id);
  }, [queryClient, activeThreadId]);

  const showListOnMobile = activeThreadId == null;

  return (
    <div className="relative mx-auto flex max-w-5xl flex-col gap-3 pb-28 sm:gap-4 sm:pb-10">
      <header className="shrink-0 px-0.5">
        <h1 className="text-xl font-semibold text-[var(--mo-text)] sm:text-2xl">Мессенджер</h1>
        <p className="mt-0.5 hidden text-sm lux-caption sm:block">
          Переписка между сотрудниками компании
        </p>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 lg:min-h-[calc(100dvh-12rem)] lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:gap-4">
        {/* Список диалогов и коллег */}
        <aside
          className={[
            "flex max-h-[calc(100dvh-11rem)] flex-col overflow-hidden rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-accent-soft)]/50 shadow-sm",
            showListOnMobile ? "flex" : "hidden lg:flex",
          ].join(" ")}
        >
          <div className="shrink-0 border-b border-[var(--mo-border)] p-3">
            <input
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              placeholder="Поиск коллег…"
              className="w-full rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/80 px-3 py-2.5 text-base sm:text-sm"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <p className="sticky top-0 z-[1] bg-[var(--mo-accent-soft)]/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide lux-caption backdrop-blur-sm">
              Диалоги
            </p>
            {(threadsQ.data ?? []).length === 0 && !threadsQ.isLoading ? (
              <p className="px-3 pb-2 text-sm lux-caption">Пока нет переписок</p>
            ) : null}
            {(threadsQ.data ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveThreadId(t.id)}
                className={[
                  "flex w-full min-h-[56px] items-center gap-3 border-b border-[var(--mo-border)]/50 px-3 py-3 text-left active:bg-white/60",
                  activeThreadId === t.id ? "bg-indigo-500/12" : "hover:bg-white/40",
                ].join(" ")}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-sm font-semibold text-indigo-800">
                  {(t.peer_name || "?").charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-[var(--mo-text)]">{t.peer_name}</span>
                    {t.last_message_at ? (
                      <span className="shrink-0 text-[10px] lux-caption">{formatTime(t.last_message_at)}</span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-xs lux-caption">
                      {t.last_message_text || "Нет сообщений"}
                    </span>
                    {t.unread_count > 0 ? (
                      <span className="shrink-0 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">
                        {t.unread_count}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            ))}

            <p className="sticky top-0 z-[1] bg-[var(--mo-accent-soft)]/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide lux-caption backdrop-blur-sm">
              Коллеги
            </p>
            {contactsQ.isLoading && <p className="px-3 py-2 text-sm lux-caption">Загрузка…</p>}
            {(contactsQ.data ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={openThreadMutation.isPending}
                onClick={() => openThreadMutation.mutate(c.id)}
                className="flex w-full min-h-[52px] items-center gap-3 border-b border-[var(--mo-border)]/50 px-3 py-3 text-left active:bg-white/60 hover:bg-white/40"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--mo-border)]/40 text-sm font-semibold text-[var(--mo-text)]">
                  {c.display_name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--mo-text)]">{c.display_name}</span>
                  <span className="text-xs lux-caption">{roleLabel(c.role)}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* Окно чата */}
        <section
          className={[
            "flex flex-col overflow-hidden rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)]/90 shadow-sm",
            activeThreadId == null ? "hidden lg:flex" : "flex",
            activeThreadId != null ? "max-lg:min-h-[calc(100dvh-11rem)] max-lg:max-h-[calc(100dvh-11rem)]" : "",
          ].join(" ")}
        >
          {!activeThreadId ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm lux-caption">
              Выберите диалог или коллегу в списке слева
            </div>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-[var(--mo-border)] px-3 py-2.5 sm:px-4 sm:py-3">
                <button
                  type="button"
                  className="btn-secondary shrink-0 px-3 py-2 text-sm lg:hidden"
                  onClick={closeChat}
                  aria-label="Назад к списку"
                >
                  ← Назад
                </button>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-sm font-semibold text-indigo-800 lg:hidden">
                  {(activeThread?.peer_name || "?").charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-[var(--mo-text)]">{activeThread?.peer_name ?? "…"}</p>
                  {activeThread?.peer_role ? (
                    <p className="truncate text-xs lux-caption">{roleLabel(activeThread.peer_role)}</p>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
                {messagesQ.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}
                {(messagesQ.data ?? []).length === 0 && !messagesQ.isLoading ? (
                  <p className="py-8 text-center text-sm lux-caption">Напишите первое сообщение</p>
                ) : null}
                {(messagesQ.data ?? []).map((m) => {
                  const mine = m.author_user_id === myId;
                  return (
                    <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                      <div
                        className={[
                          "max-w-[min(85%,20rem)] rounded-2xl px-3 py-2 text-sm break-words",
                          mine
                            ? "bg-indigo-600 text-white"
                            : "border border-[var(--mo-border)] bg-white/90 text-[var(--mo-text)]",
                        ].join(" ")}
                      >
                        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.text}</p>
                        <p
                          className={
                            mine ? "mt-1 text-right text-[10px] text-indigo-100/90" : "mt-1 text-[10px] lux-caption"
                          }
                        >
                          {formatTime(m.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <form
                className="sticky bottom-0 z-10 flex shrink-0 gap-2 border-t border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = draft.trim();
                  if (!text || activeThreadId == null) return;
                  sendMutation.mutate(text);
                }}
              >
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Сообщение…"
                  enterKeyHint="send"
                  className="min-w-0 flex-1 rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/90 px-3 py-2.5 text-base sm:text-sm"
                />
                <button
                  type="submit"
                  disabled={sendMutation.isPending || !draft.trim()}
                  className="btn-primary shrink-0 px-4 py-2.5 sm:min-w-[6.5rem]"
                >
                  {sendMutation.isPending ? "…" : "Отправить"}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
