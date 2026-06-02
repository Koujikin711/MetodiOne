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

function formatTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function TeamMessengerPage() {
  const queryClient = useQueryClient();
  const myId = decodeUserIdFromToken(getStoredToken());
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-5xl flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold text-[var(--mo-text)]">Мессенджер</h1>
        <p className="text-sm lux-caption">Переписка между сотрудниками компании</p>
      </header>

      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-accent-soft)]/40">
        <aside className="flex w-full max-w-xs shrink-0 flex-col border-r border-[var(--mo-border)]">
          <div className="border-b border-[var(--mo-border)] p-3">
            <input
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              placeholder="Поиск коллег…"
              className="w-full rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/60 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide lux-caption">Диалоги</p>
            {(threadsQ.data ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveThreadId(t.id)}
                className={[
                  "flex w-full flex-col gap-0.5 border-b border-[var(--mo-border)]/50 px-3 py-2.5 text-left text-sm transition",
                  activeThreadId === t.id ? "bg-indigo-500/15" : "hover:bg-white/40",
                ].join(" ")}
              >
                <span className="flex items-center justify-between gap-2 font-medium text-[var(--mo-text)]">
                  {t.peer_name}
                  {t.unread_count > 0 ? (
                    <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-bold text-white">
                      {t.unread_count}
                    </span>
                  ) : null}
                </span>
                <span className="truncate text-xs lux-caption">{t.last_message_text || "Нет сообщений"}</span>
              </button>
            ))}
            <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide lux-caption">Коллеги</p>
            {(contactsQ.data ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={openThreadMutation.isPending}
                onClick={() => openThreadMutation.mutate(c.id)}
                className="flex w-full flex-col gap-0.5 border-b border-[var(--mo-border)]/50 px-3 py-2.5 text-left text-sm hover:bg-white/40"
              >
                <span className="font-medium text-[var(--mo-text)]">{c.display_name}</span>
                <span className="text-xs lux-caption">{c.role}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          {!activeThreadId ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm lux-caption">
              Выберите диалог или коллегу слева
            </div>
          ) : (
            <>
              <div className="border-b border-[var(--mo-border)] px-4 py-3">
                <p className="font-semibold text-[var(--mo-text)]">{activeThread?.peer_name ?? "…"}</p>
                {activeThread?.peer_role ? (
                  <p className="text-xs lux-caption">{activeThread.peer_role}</p>
                ) : null}
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {messagesQ.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}
                {(messagesQ.data ?? []).map((m) => {
                  const mine = m.author_user_id === myId;
                  return (
                    <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                      <div
                        className={[
                          "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                          mine
                            ? "bg-indigo-600 text-white"
                            : "border border-[var(--mo-border)] bg-white/80 text-[var(--mo-text)]",
                        ].join(" ")}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.text}</p>
                        <p className={mine ? "mt-1 text-[10px] text-indigo-100" : "mt-1 text-[10px] lux-caption"}>
                          {formatTime(m.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
              <form
                className="flex gap-2 border-t border-[var(--mo-border)] p-3"
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
                  className="min-w-0 flex-1 rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/70 px-3 py-2 text-sm"
                />
                <button type="submit" disabled={sendMutation.isPending || !draft.trim()} className="btn-primary shrink-0">
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
