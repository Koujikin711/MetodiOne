import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import type { Lead } from "@/lib/types";

type Props = {
  leadId: number;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

type WaitingCallbackCreateBody = {
  lead_id: number;
  client_name: string;
  client_phone: string;
  pain_text: string;
  scheduled_at: string;
  set_waiting_stage: boolean;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ymdLocal(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDaysYmd(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return ymdLocal(dt);
}

function weekdayShort(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
}

/** Слоты 09:00–20:00 каждые 30 минут. */
function daySlots(): number[] {
  const out: number[] = [];
  for (let h = 9; h < 20; h++) {
    out.push(h * 60);
    out.push(h * 60 + 30);
  }
  return out;
}

function minuteLabel(min: number) {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

function toIsoLocal(ymd: string, minuteOfDay: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return dt.toISOString();
}

export function WaitingCallbackModal({ leadId, open, onClose, onSaved }: Props) {
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [painText, setPainText] = useState("");
  const [weekAnchor, setWeekAnchor] = useState(() => ymdLocal(new Date()));
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);
  const [selectedMinute, setSelectedMinute] = useState<number | null>(null);

  const leadQuery = useQuery({
    queryKey: ["lead", leadId, "waiting-modal"],
    queryFn: () => apiFetch<Lead>(`/api/leads/${leadId}`),
    enabled: open && leadId > 0,
  });

  useEffect(() => {
    if (!open) return;
    setPainText("");
    setSelectedYmd(null);
    setSelectedMinute(null);
    setWeekAnchor(ymdLocal(new Date()));
  }, [open, leadId]);

  useEffect(() => {
    if (!leadQuery.data) return;
    setClientName(leadQuery.data.name || "");
    setClientPhone(leadQuery.data.phone_display || leadQuery.data.phone || "");
  }, [leadQuery.data]);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysYmd(weekAnchor, i)), [weekAnchor]);
  const slots = useMemo(() => daySlots(), []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedYmd || selectedMinute == null) {
        throw new Error("Выберите дату и время на сетке");
      }
      if (!clientName.trim()) throw new Error("Укажите ФИО клиента");
      if (!painText.trim()) throw new Error("Заполните «Боль» клиента");
      const body: WaitingCallbackCreateBody = {
        lead_id: leadId,
        client_name: clientName.trim(),
        client_phone: clientPhone.trim(),
        pain_text: painText.trim(),
        scheduled_at: toIsoLocal(selectedYmd, selectedMinute),
        set_waiting_stage: true,
      };
      return apiFetch("/api/waiting-callbacks", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      toast.success("Клиент в «В ожидании». Напоминания запланированы");
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось сохранить"),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4">
      <div
        className="flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] shadow-2xl sm:rounded-2xl"
        role="dialog"
        aria-modal
        aria-label="В ожидании — дата связи"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--mo-border)] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--mo-text)] sm:text-lg">В ожидании · дата связи</h2>
            <p className="mt-0.5 text-xs mo-muted">
              Сетка как в онлайн-записи. За сутки — задача менеджеру с «Боль». В момент — WhatsApp клиенту.
            </p>
          </div>
          <button type="button" className="btn-secondary !min-h-9 px-3 text-sm" onClick={onClose}>
            Закрыть
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[11px] mo-muted">
              ФИО клиента
              <input
                className="mo-input mt-1 w-full !min-h-11 text-base"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="ФИО"
              />
            </label>
            <label className="block text-[11px] mo-muted">
              Телефон (авто)
              <input
                className="mo-input mt-1 w-full !min-h-11 text-base"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                placeholder="+992…"
              />
            </label>
          </div>
          <label className="block text-[11px] mo-muted">
            Боль клиента
            <textarea
              className="mo-input mt-1 min-h-[88px] w-full text-base"
              value={painText}
              onChange={(e) => setPainText(e.target.value)}
              placeholder="Что болит / зачем перезвонить…"
            />
          </label>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="btn-secondary !min-h-9 px-3 text-xs"
              onClick={() => setWeekAnchor((w) => addDaysYmd(w, -7))}
            >
              ← Неделя
            </button>
            <span className="text-xs mo-muted">
              {selectedYmd && selectedMinute != null
                ? `${weekdayShort(selectedYmd)} · ${minuteLabel(selectedMinute)}`
                : "Выберите слот"}
            </span>
            <button
              type="button"
              className="btn-secondary !min-h-9 px-3 text-xs"
              onClick={() => setWeekAnchor((w) => addDaysYmd(w, 7))}
            >
              Неделя →
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--mo-border)]">
            <div className="grid min-w-[720px] grid-cols-7 divide-x divide-[var(--mo-border)]">
              {weekDays.map((ymd) => (
                <div key={ymd} className="min-w-0">
                  <div className="sticky top-0 z-[1] border-b border-[var(--mo-border)] bg-[var(--mo-surface)] px-1 py-2 text-center text-[11px] font-semibold text-[var(--mo-text)]">
                    {weekdayShort(ymd)}
                  </div>
                  <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto p-1">
                    {slots.map((min) => {
                      const active = selectedYmd === ymd && selectedMinute === min;
                      return (
                        <button
                          key={`${ymd}-${min}`}
                          type="button"
                          className={[
                            "rounded-md px-1 py-1.5 text-[11px] tabular-nums transition",
                            active
                              ? "bg-[var(--mo-accent)] font-semibold text-white"
                              : "bg-[var(--mo-accent-soft)]/40 text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)]",
                          ].join(" ")}
                          onClick={() => {
                            setSelectedYmd(ymd);
                            setSelectedMinute(min);
                          }}
                        >
                          {minuteLabel(min)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="flex gap-2 border-t border-[var(--mo-border)] px-4 py-3">
          <button type="button" className="btn-secondary min-h-11 flex-1" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="min-h-11 flex-1 rounded-xl bg-[var(--mo-accent)] px-4 text-sm font-semibold text-white disabled:opacity-50"
            disabled={saveMutation.isPending || leadQuery.isLoading}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? "Сохранение…" : "Сохранить в ожидание"}
          </button>
        </footer>
      </div>
    </div>
  );
}
