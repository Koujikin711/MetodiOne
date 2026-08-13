import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";

import { apiFetch } from "@/lib/api";
import { useCurrentUserMe } from "@/hooks/useCurrentUserMe";
import type { ManagerDeskSale, Pipeline } from "@/lib/types";
import { ActivitySphereField } from "@/components/ActivitySphereField";

function formatMoney(v: string | number) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} TJS`;
}

const fieldClass =
  "mo-input mt-1 w-full !min-h-11 !py-2.5 text-base sm:!min-h-0 sm:!py-2 sm:text-sm";

export function ManagerSalesPage() {
  const me = useCurrentUserMe();
  const qc = useQueryClient();
  const enabled = Boolean(me.data?.desk_sales_enabled);

  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiFetch<Pipeline[]>("/api/pipelines"),
    enabled,
  });

  const salesQuery = useQuery({
    queryKey: ["desk-sales"],
    queryFn: () => apiFetch<ManagerDeskSale[]>("/api/desk-sales"),
    enabled,
  });

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [activitySphere, setActivitySphere] = useState("");
  const [serviceAmount, setServiceAmount] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [pipelineId, setPipelineId] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<ManagerDeskSale>("/api/desk-sales", {
        method: "POST",
        body: JSON.stringify({
          client_name: clientName.trim(),
          client_phone: clientPhone.trim(),
          activity_sphere: activitySphere.trim(),
          service_amount: Number(serviceAmount.replace(",", ".")),
          paid_amount: Number(paidAmount.replace(",", ".")),
          pipeline_id: pipelineId === "" ? null : pipelineId,
          note: note.trim() || null,
        }),
      }),
    onSuccess: () => {
      toast.success("Продажа сохранена");
      setClientName("");
      setClientPhone("");
      setActivitySphere("");
      setServiceAmount("");
      setPaidAmount("");
      setNote("");
      setShowNote(false);
      void qc.invalidateQueries({ queryKey: ["desk-sales"] });
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось сохранить"),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/desk-sales/${id}/cancel`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Продажа отменена");
      void qc.invalidateQueries({ queryKey: ["desk-sales"] });
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось отменить"),
  });

  if (me.isLoading) {
    return <p className="text-sm mo-muted">Загрузка…</p>;
  }

  if (!enabled) {
    return (
      <div className="mo-section p-4">
        <h1 className="text-lg font-semibold text-[var(--mo-text)]">Продажи</h1>
        <p className="mt-1 text-sm mo-muted">Раздел доступен только в пространстве без онлайн-записи.</p>
      </div>
    );
  }

  const pipelines = pipelinesQuery.data ?? [];

  return (
    <div className="sales-space-page mx-auto max-w-3xl space-y-3 pb-[5.5rem] sm:space-y-5 sm:pb-0">
      <header className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-[var(--mo-text)] sm:text-2xl">Продажи</h1>
          <p className="mt-0.5 text-[11px] leading-snug mo-muted sm:mt-1 sm:text-sm">
            Смета модулей — в{" "}
            <Link to="/quote" className="font-medium text-[var(--mo-accent-hover)] underline-offset-2 hover:underline">
              Калькуляции
            </Link>
            .
          </p>
        </div>
      </header>

      <section className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-3 sm:p-4">
        <h2 className="text-sm font-semibold text-[var(--mo-text)]">Новая продажа</h2>
        <form
          className="mt-2 grid grid-cols-2 gap-2 sm:gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <label className="col-span-2 text-xs sm:col-span-1 sm:text-sm">
            <span className="mo-muted">ФИО клиента</span>
            <input
              required
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className={fieldClass}
              placeholder="Имя Фамилия"
              autoComplete="name"
            />
          </label>
          <label className="col-span-2 text-xs sm:col-span-1 sm:text-sm">
            <span className="mo-muted">Телефон</span>
            <input
              required
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              className={fieldClass}
              placeholder="+992…"
              inputMode="tel"
              autoComplete="tel"
            />
          </label>
          <label className="col-span-2 text-xs sm:text-sm">
            <span className="mo-muted">Сфера деятельности</span>
            <ActivitySphereField
              required
              value={activitySphere}
              onChange={setActivitySphere}
              className={fieldClass}
            />
          </label>
          <label className="text-xs sm:text-sm">
            <span className="mo-muted">Стоимость</span>
            <input
              required
              inputMode="decimal"
              value={serviceAmount}
              onChange={(e) => setServiceAmount(e.target.value)}
              className={fieldClass}
              placeholder="TJS"
            />
          </label>
          <label className="text-xs sm:text-sm">
            <span className="mo-muted">Оплатил</span>
            <input
              required
              inputMode="decimal"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
              className={fieldClass}
              placeholder="TJS"
            />
          </label>
          {pipelines.length > 0 ? (
            <label className="col-span-2 text-xs sm:text-sm">
              <span className="mo-muted">Воронка</span>
              <select
                value={pipelineId === "" ? "" : String(pipelineId)}
                onChange={(e) => setPipelineId(e.target.value ? Number(e.target.value) : "")}
                className={fieldClass}
              >
                <option value="">Авто</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <button
            type="button"
            className="col-span-2 min-h-10 rounded-xl border border-dashed border-[var(--mo-border)] px-3 py-2 text-left text-xs font-medium text-[var(--mo-accent)] sm:hidden"
            onClick={() => setShowNote((v) => !v)}
          >
            {showNote ? "Скрыть заметку" : "+ Заметка"}
          </button>
          <label className={`col-span-2 text-xs sm:text-sm ${showNote ? "" : "hidden sm:block"}`}>
            <span className="mo-muted">Заметка</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={fieldClass} />
          </label>

          <div className="col-span-2 hidden sm:block">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-xl bg-[var(--mo-accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {createMutation.isPending ? "Сохранение…" : "Сохранить продажу"}
            </button>
          </div>
        </form>
      </section>

      <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-40 border-t border-[var(--mo-border)] bg-[var(--mo-surface-elevated)]/95 px-3 py-2.5 backdrop-blur sm:hidden">
        <button
          type="button"
          disabled={createMutation.isPending}
          onClick={() => createMutation.mutate()}
          className="min-h-12 w-full rounded-xl bg-[var(--mo-accent)] px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
        >
          {createMutation.isPending ? "Сохранение…" : "Сохранить продажу"}
        </button>
      </div>

      <section className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-3 sm:p-4">
        <h2 className="mb-2 text-sm font-semibold text-[var(--mo-text)]">Последние продажи</h2>
        {salesQuery.isLoading ? (
          <p className="text-sm mo-muted">Загрузка…</p>
        ) : (salesQuery.data?.length ?? 0) === 0 ? (
          <p className="text-sm mo-muted">Пока нет продаж.</p>
        ) : (
          <>
            <ul className="space-y-2 sm:hidden">
              {(salesQuery.data ?? []).map((s) => (
                <li key={s.id} className="rounded-xl border border-[var(--mo-border)] px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--mo-text)]">{s.client_name}</p>
                      <p className="truncate text-xs mo-muted">{s.client_phone}</p>
                    </div>
                    <time className="shrink-0 text-[11px] tabular-nums mo-muted">
                      {new Date(s.sold_at).toLocaleString("ru-RU", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p className="mt-1 text-xs text-[var(--mo-text)]">{s.activity_sphere}</p>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                    <span className="tabular-nums">
                      {formatMoney(s.paid_amount)} / {formatMoney(s.service_amount)}
                    </span>
                    <button
                      type="button"
                      className="text-rose-500"
                      onClick={() => {
                        if (confirm("Отменить эту продажу?")) cancelMutation.mutate(s.id);
                      }}
                    >
                      Отменить
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs mo-muted">
                  <tr>
                    <th className="px-2 py-2">Дата</th>
                    <th className="px-2 py-2">Клиент</th>
                    <th className="px-2 py-2">Сфера</th>
                    <th className="px-2 py-2">Стоимость</th>
                    <th className="px-2 py-2">Оплачено</th>
                    <th className="px-2 py-2">Менеджер</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {(salesQuery.data ?? []).map((s) => (
                    <tr key={s.id} className="border-t border-[var(--mo-border)]">
                      <td className="px-2 py-2 whitespace-nowrap">
                        {new Date(s.sold_at).toLocaleString("ru-RU")}
                      </td>
                      <td className="px-2 py-2">
                        <div>{s.client_name}</div>
                        <div className="text-xs mo-muted">{s.client_phone}</div>
                      </td>
                      <td className="px-2 py-2">{s.activity_sphere}</td>
                      <td className="px-2 py-2 tabular-nums">{formatMoney(s.service_amount)}</td>
                      <td className="px-2 py-2 tabular-nums">{formatMoney(s.paid_amount)}</td>
                      <td className="px-2 py-2">{s.manager_name || "—"}</td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          className="text-xs text-rose-300 hover:underline"
                          onClick={() => {
                            if (confirm("Отменить эту продажу?")) cancelMutation.mutate(s.id);
                          }}
                        >
                          Отменить
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
