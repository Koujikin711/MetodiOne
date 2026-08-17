import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";

import { ActivitySphereField } from "@/components/ActivitySphereField";
import { PageHeader } from "@/components/ui/PageHeader";
import { apiFetch } from "@/lib/api";
import { useCurrentUserMe } from "@/hooks/useCurrentUserMe";
import type { ManagerDeskSale, Pipeline } from "@/lib/types";

function formatMoney(v: string | number) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} TJS`;
}

const fieldClass = "mo-input mt-1.5 w-full";

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
    return <p className="lux-caption">Загрузка…</p>;
  }

  if (!enabled) {
    return (
      <div className="mo-section p-5">
        <h1 className="lux-heading">Продажи</h1>
        <p className="lux-body mt-2">Раздел доступен только в пространстве без онлайн-записи.</p>
      </div>
    );
  }

  const pipelines = pipelinesQuery.data ?? [];

  return (
    <div className="sales-space-page mo-fill-page sales-desk-page">
      <div className="mo-admin-page-head shrink-0">
        <PageHeader
          className="mb-0"
          title="Продажи"
          description={
            <>
              Смета модулей — в{" "}
              <Link to="/quote" className="mo-link">
                Калькуляции
              </Link>
              .
            </>
          }
        />
      </div>

      <div className="mo-fill-page-scroll sales-desk-scroll space-y-4 pt-4 sm:space-y-5">
        <section className="mo-section p-4 sm:p-5">
          <h2 className="lux-heading">Новая продажа</h2>
          <form
            className="mt-4 grid w-full grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6 sm:gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
          >
            <label className="col-span-2 text-xs font-medium sm:col-span-1 lg:col-span-2 sm:text-sm">
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
            <label className="col-span-2 text-xs font-medium sm:col-span-1 lg:col-span-2 sm:text-sm">
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
            <label className="col-span-2 text-xs font-medium sm:col-span-1 lg:col-span-2 sm:text-sm">
              <span className="mo-muted">Сфера деятельности</span>
              <ActivitySphereField
                required
                value={activitySphere}
                onChange={setActivitySphere}
                className={fieldClass}
              />
            </label>
            <label className="text-xs font-medium sm:text-sm">
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
            <label className="text-xs font-medium sm:text-sm">
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
              <label className="col-span-2 text-xs font-medium sm:col-span-1 lg:col-span-2 sm:text-sm">
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
              className="col-span-2 min-h-10 rounded-xl border border-dashed border-[var(--mo-border-strong)] bg-[var(--mo-accent-soft)] px-3 py-2 text-left text-xs font-semibold text-[var(--mo-accent-hover)] sm:hidden"
              onClick={() => setShowNote((v) => !v)}
            >
              {showNote ? "Скрыть заметку" : "+ Заметка"}
            </button>
            <label
              className={`col-span-2 text-xs font-medium sm:col-span-3 lg:col-span-6 sm:text-sm ${showNote ? "" : "hidden sm:block"}`}
            >
              <span className="mo-muted">Заметка</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} className={fieldClass} />
            </label>

            <div className="col-span-2 hidden sm:col-span-3 lg:col-span-6 sm:block">
              <button type="submit" disabled={createMutation.isPending} className="btn-primary px-5 py-2.5">
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
            className="btn-primary min-h-12 w-full px-4 py-3 text-base"
          >
            {createMutation.isPending ? "Сохранение…" : "Сохранить продажу"}
          </button>
        </div>

        <section className="sales-desk-table mo-section flex min-h-0 flex-1 flex-col p-4 sm:p-5">
          <h2 className="lux-heading shrink-0">Последние продажи</h2>
          {salesQuery.isLoading ? (
            <p className="mt-3 lux-caption">Загрузка…</p>
          ) : (salesQuery.data?.length ?? 0) === 0 ? (
            <p className="mt-3 lux-caption">Пока нет продаж.</p>
          ) : (
            <>
              <ul className="mt-3 space-y-2 sm:hidden">
                {(salesQuery.data ?? []).map((s) => (
                  <li key={s.id} className="rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)] px-3 py-2.5">
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
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
                      <span className="tabular-nums font-medium">
                        {formatMoney(s.paid_amount)} / {formatMoney(s.service_amount)}
                      </span>
                      <button
                        type="button"
                        className="font-medium text-[var(--mo-danger)]"
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
              <div className="mt-3 hidden min-h-0 flex-1 overflow-auto sm:block">
                <table className="mo-table">
                  <thead>
                    <tr>
                      <th className="px-2 py-2.5">Дата</th>
                      <th className="px-2 py-2.5">Клиент</th>
                      <th className="px-2 py-2.5">Сфера</th>
                      <th className="px-2 py-2.5">Стоимость</th>
                      <th className="px-2 py-2.5">Оплачено</th>
                      <th className="px-2 py-2.5">Менеджер</th>
                      <th className="px-2 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {(salesQuery.data ?? []).map((s) => (
                      <tr key={s.id}>
                        <td className="whitespace-nowrap px-2 py-2.5">{new Date(s.sold_at).toLocaleString("ru-RU")}</td>
                        <td className="px-2 py-2.5">
                          <div className="font-medium">{s.client_name}</div>
                          <div className="text-xs mo-muted">{s.client_phone}</div>
                        </td>
                        <td className="px-2 py-2.5">{s.activity_sphere}</td>
                        <td className="px-2 py-2.5 tabular-nums">{formatMoney(s.service_amount)}</td>
                        <td className="px-2 py-2.5 tabular-nums">{formatMoney(s.paid_amount)}</td>
                        <td className="px-2 py-2.5">{s.manager_name || "—"}</td>
                        <td className="px-2 py-2.5">
                          <button
                            type="button"
                            className="text-xs font-medium text-[var(--mo-danger)] hover:underline"
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
    </div>
  );
}
