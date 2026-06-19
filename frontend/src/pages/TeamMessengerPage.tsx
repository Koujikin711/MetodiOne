import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { MessageCircle } from "@/components/icons";
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

function avatarInitial(name: string) {
  return (name || "?").charAt(0).toUpperCase();
}

export function TeamMessengerPage() {
  const queryClient = useQueryClient();
  const myId = decodeUserIdFromToken(getStoredToken());
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);

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
    const box = messagesScrollRef.current;
    if (!box) return;
    box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
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
    <div className="team-messenger">
      <header className="team-messenger-header">
        <h1>Мессенджер</h1>
        <p className="hidden sm:block">Безопасная переписка между сотрудниками клиники</p>
      </header>

      <div className="team-messenger-shell">
        <aside
          className={[
            "team-messenger-rail",
            showListOnMobile ? "is-visible-mobile" : "is-hidden-mobile",
          ].join(" ")}
        >
          <div className="team-messenger-search">
            <input
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              placeholder="Поиск коллег…"
              aria-label="Поиск коллег"
            />
          </div>

          <div className="team-messenger-list">
            <p className="team-messenger-section-label">Диалоги</p>
            {(threadsQ.data ?? []).length === 0 && !threadsQ.isLoading ? (
              <p className="team-messenger-muted">Пока нет переписок</p>
            ) : null}
            {(threadsQ.data ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveThreadId(t.id)}
                className={["team-messenger-row", activeThreadId === t.id ? "is-active" : ""].filter(Boolean).join(" ")}
              >
                <span className="team-messenger-avatar">{avatarInitial(t.peer_name)}</span>
                <span className="team-messenger-row-meta">
                  <span className="team-messenger-row-title">
                    <span className="team-messenger-row-name">{t.peer_name}</span>
                    {t.last_message_at ? (
                      <span className="team-messenger-row-time">{formatTime(t.last_message_at)}</span>
                    ) : null}
                  </span>
                  <span className="team-messenger-row-sub">
                    <span className="team-messenger-row-preview">{t.last_message_text || "Нет сообщений"}</span>
                    {t.unread_count > 0 ? (
                      <span className="team-messenger-unread">{t.unread_count}</span>
                    ) : null}
                  </span>
                </span>
              </button>
            ))}

            <p className="team-messenger-section-label">Коллеги</p>
            {contactsQ.isLoading ? <p className="team-messenger-muted">Загрузка…</p> : null}
            {(contactsQ.data ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={openThreadMutation.isPending}
                onClick={() => openThreadMutation.mutate(c.id)}
                className="team-messenger-row"
              >
                <span className="team-messenger-avatar">{avatarInitial(c.display_name)}</span>
                <span className="team-messenger-row-meta">
                  <span className="team-messenger-row-name">{c.display_name}</span>
                  <span className="team-messenger-row-role">{roleLabel(c.role)}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section
          className={[
            "team-messenger-chat",
            activeThreadId == null ? "is-hidden-mobile" : "is-visible-mobile",
          ].join(" ")}
        >
          {activeThreadId == null ? (
            <div className="team-messenger-empty">
              <span className="team-messenger-empty-icon" aria-hidden>
                <MessageCircle className="h-7 w-7" />
              </span>
              <p>Выберите диалог или коллегу в списке слева, чтобы начать переписку</p>
            </div>
          ) : (
            <>
              <div className="team-messenger-chat-header">
                <button type="button" className="team-messenger-back" onClick={closeChat} aria-label="Назад к списку">
                  ← Назад
                </button>
                <span className="team-messenger-avatar lg:hidden">{avatarInitial(activeThread?.peer_name ?? "")}</span>
                <div className="min-w-0 flex-1">
                  <p className="team-messenger-chat-header-name">{activeThread?.peer_name ?? "…"}</p>
                  {activeThread?.peer_role ? (
                    <p className="team-messenger-chat-header-role">{roleLabel(activeThread.peer_role)}</p>
                  ) : null}
                </div>
              </div>

              <div ref={messagesScrollRef} className="team-messenger-messages">
                {messagesQ.isLoading ? <p className="team-messenger-muted">Загрузка…</p> : null}
                {(messagesQ.data ?? []).length === 0 && !messagesQ.isLoading ? (
                  <p className="py-8 text-center text-sm" style={{ color: "var(--mo-text-muted)" }}>
                    Напишите первое сообщение
                  </p>
                ) : null}
                {(messagesQ.data ?? []).map((m) => {
                  const mine = m.author_user_id === myId;
                  return (
                    <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                      <div className={["team-messenger-bubble", mine ? "is-mine" : "is-theirs"].join(" ")}>
                        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.text}</p>
                        <p className="team-messenger-bubble-time">{formatTime(m.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <form
                className="team-messenger-compose"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = draft.trim();
                  if (!text || activeThreadId == null) return;
                  sendMutation.mutate(text);
                }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Сообщение…"
                  enterKeyHint="send"
                  aria-label="Текст сообщения"
                />
                <button type="submit" disabled={sendMutation.isPending || !draft.trim()} className="team-messenger-send">
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
