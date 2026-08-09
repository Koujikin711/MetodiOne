import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import type { PaymentRuleCreate, ServiceTemplateRead } from "@/lib/types";

export function ServiceCatalogPage() {
  const qc = useQueryClient();
  const [pipelineId, setPipelineId] = useState<number | "">("");
  const pipelinesQ = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiFetch<{ id: number; name: string }[]>("/api/pipelines"),
  });
  const pid = pipelineId === "" ? null : Number(pipelineId);

  const templatesQ = useQuery({
    queryKey: ["service-templates", pid],
    enabled: pid != null,
    queryFn: () => apiFetch<ServiceTemplateRead[]>(`/api/services/templates?pipeline_id=${pid}&active_only=false`),
  });

  const [name, setName] = useState("");
  const [serviceType, setServiceType] = useState<"single" | "protocol" | "course">("course");
  const [priceBase, setPriceBase] = useState("0");
  const [durationDays, setDurationDays] = useState("15");
  const [rules, setRules] = useState<PaymentRuleCreate[]>([
    { sort_order: 1, label: "Этап 1", kind: "percent", value: 40, trigger_type: "on_enrollment" },
    { sort_order: 2, label: "Этап 2", kind: "percent", value: 40, trigger_type: "course_day", trigger_day: 10 },
    { sort_order: 3, label: "Этап 3", kind: "percent", value: 20, trigger_type: "course_day", trigger_day: 15 },
  ]);

  const migrateMut = useMutation({
    mutationFn: () => apiFetch<{ created: number; skipped: number }>("/api/services/migrate-legacy-templates", { method: "POST" }),
    onSuccess: (data) => {
      toast.success(`Миграция: создано ${data.created}, пропущено ${data.skipped}`);
      void qc.invalidateQueries({ queryKey: ["service-templates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createMut = useMutation({
    mutationFn: () => {
      if (pid == null) throw new Error("Выберите воронку");
      return apiFetch<ServiceTemplateRead>("/api/services/templates", {
        method: "POST",
        body: JSON.stringify({
          pipeline_id: pid,
          name: name.trim(),
          service_type: serviceType,
          duration_days: serviceType === "course" ? Number(durationDays) : null,
          price_base: Number(priceBase),
          course_streams_enabled: serviceType === "course",
          payment_rules: rules,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Услуга создана");
      setName("");
      void qc.invalidateQueries({ queryKey: ["service-templates", pid] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pipelineOptions = useMemo(() => pipelinesQ.data ?? [], [pipelinesQ.data]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--mo-text)]">Конструктор услуг</h1>
          <p className="mt-1 text-sm lux-caption">Каталог привязан к воронке. Произвольное число этапов оплаты.</p>
        </div>
        <button type="button" className="btn-secondary text-sm" disabled={migrateMut.isPending} onClick={() => migrateMut.mutate()}>
          Импорт из записей
        </button>
      </header>

      <section className="mo-section p-4">
        <label className="text-sm lux-caption">
          Воронка
          <select
            className="mo-input mt-1"
            value={pipelineId}
            onChange={(e) => setPipelineId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">— выберите —</option>
            {pipelineOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {pid != null && (
        <>
          <section className="mo-section space-y-3 p-4">
            <h2 className="lux-subheading">Новая услуга</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="mo-input" placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} />
              <select className="mo-input" value={serviceType} onChange={(e) => setServiceType(e.target.value as typeof serviceType)}>
                <option value="single">Разовая</option>
                <option value="protocol">Протокол</option>
                <option value="course">Курс</option>
              </select>
              <input className="mo-input" type="number" min={0} placeholder="Цена (TJS)" value={priceBase} onChange={(e) => setPriceBase(e.target.value)} />
              {serviceType === "course" && (
                <input className="mo-input" type="number" min={1} placeholder="Дней курса" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
              )}
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Этапы оплаты</div>
              {rules.map((r, idx) => (
                <div key={idx} className="grid gap-2 rounded-xl border border-[var(--mo-border)] p-2 sm:grid-cols-4">
                  <input className="mo-input" value={r.label ?? ""} onChange={(e) => setRules((prev) => prev.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))} placeholder="Название этапа" />
                  <select className="mo-input" value={r.kind} onChange={(e) => setRules((prev) => prev.map((x, i) => (i === idx ? { ...x, kind: e.target.value as "percent" | "fixed" } : x)))}>
                    <option value="percent">%</option>
                    <option value="fixed">Сумма</option>
                  </select>
                  <input className="mo-input" type="number" value={Number(r.value)} onChange={(e) => setRules((prev) => prev.map((x, i) => (i === idx ? { ...x, value: Number(e.target.value) } : x)))} />
                  <input className="mo-input" type="number" placeholder="День курса" value={r.trigger_day ?? ""} onChange={(e) => setRules((prev) => prev.map((x, i) => (i === idx ? { ...x, trigger_type: "course_day", trigger_day: Number(e.target.value) } : x)))} />
                </div>
              ))}
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() =>
                  setRules((prev) => [
                    ...prev,
                    { sort_order: prev.length + 1, label: `Этап ${prev.length + 1}`, kind: "percent", value: 0, trigger_type: "on_enrollment" },
                  ])
                }
              >
                + Этап
              </button>
            </div>
            <button type="button" className="btn-primary" disabled={!name.trim() || createMut.isPending} onClick={() => createMut.mutate()}>
              Сохранить услугу
            </button>
          </section>

          <section className="mo-section p-4">
            <h2 className="mb-3 lux-subheading">Каталог воронки</h2>
            {(templatesQ.data ?? []).map((t) => (
              <div key={t.id} className="mb-2 rounded-xl border border-[var(--mo-border)] p-3">
                <div className="font-semibold">{t.name}</div>
                <div className="text-xs lux-caption">
                  {t.service_type} · {formatMoney(t.price_base)} · этапов: {t.payment_rules.length}
                </div>
              </div>
            ))}
            {!templatesQ.isLoading && (templatesQ.data ?? []).length === 0 && <p className="text-sm lux-caption">Пока нет услуг</p>}
          </section>
        </>
      )}
    </div>
  );
}
