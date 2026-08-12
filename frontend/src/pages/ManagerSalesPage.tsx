import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import { useCurrentUserMe } from "@/hooks/useCurrentUserMe";
import type { ManagerDeskSale, Pipeline } from "@/lib/types";

function formatMoney(v: string | number) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TJS`;
}

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
      <div className="mo-section p-6">
        <h1 className="text-xl font-semibold text-[var(--mo-text)]">Продажи</h1>
        <p className="mt-2 text-sm mo-muted">
          Раздел доступен только в пространстве без онлайн-записи.
        </p>
      </div>
    );
  }

  const pipelines = pipelinesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--mo-text)]">Продажи</h1>
          <p className="mt-1 text-sm mo-muted">
            Вместо онлайн-записи: стоимость, сфера деятельности, ФИО, телефон и сумма оплаты. Данные идут в отчёты
            компании и дебиторку. Сумму модулей можно собрать в{" "}
            <a href="/quote" className="underline underline-offset-2">
              Калькуляции
            </a>
            .
          </p>
        </div>
      </header>

      <section className="mo-section p-4">
        <h2 className="text-sm font-semibold text-[var(--mo-text)]">Новая продажа</h2>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <label className="text-sm">
            <span className="mo-muted">ФИО клиента</span>
            <input
              required
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="mo-input mt-1 w-full"
              placeholder="Имя Фамилия"
            />
          </label>
          <label className="text-sm">
            <span className="mo-muted">Телефон</span>
            <input
              required
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              className="mo-input mt-1 w-full"
              placeholder="+992…"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mo-muted">Сфера деятельности клиента</span>
            <input
              required
              value={activitySphere}
              onChange={(e) => setActivitySphere(e.target.value)}
              className="mo-input mt-1 w-full"
              placeholder="Например: медицина, торговля…"
            />
          </label>
          <label className="text-sm">
            <span className="mo-muted">Стоимость (TJS)</span>
            <input
              required
              inputMode="decimal"
              value={serviceAmount}
              onChange={(e) => setServiceAmount(e.target.value)}
              className="mo-input mt-1 w-full"
            />
          </label>
          <label className="text-sm">
            <span className="mo-muted">Сколько взял денег (TJS)</span>
            <input
              required
              inputMode="decimal"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
              className="mo-input mt-1 w-full"
            />
          </label>
          {pipelines.length > 0 ? (
            <label className="text-sm sm:col-span-2">
              <span className="mo-muted">Воронка</span>
              <select
                value={pipelineId === "" ? "" : String(pipelineId)}
                onChange={(e) => setPipelineId(e.target.value ? Number(e.target.value) : "")}
                className="mo-input mt-1 w-full"
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
          <label className="text-sm sm:col-span-2">
            <span className="mo-muted">Заметка</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="mo-input mt-1 w-full" />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-xl bg-[var(--mo-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {createMutation.isPending ? "Сохранение…" : "Сохранить продажу"}
            </button>
          </div>
        </form>
      </section>

      <section className="mo-section p-4">
        <h2 className="mb-3 text-sm font-semibold text-[var(--mo-text)]">Последние продажи</h2>
        {salesQuery.isLoading ? (
          <p className="text-sm mo-muted">Загрузка…</p>
        ) : (salesQuery.data?.length ?? 0) === 0 ? (
          <p className="text-sm lux-caption">Пока нет продаж.</p>
        ) : (
          <div className="overflow-x-auto">
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
        )}
      </section>
    </div>
  );
}
