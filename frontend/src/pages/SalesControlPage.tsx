import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { AccessDenied } from "@/components/AccessDenied";
import { DateField } from "@/components/DateField";
import { ProtocolQueuePanel } from "@/components/ProtocolQueuePanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import type { SalesKpiManualSale } from "@/lib/types";

type Section = "protocols" | "courses";

function todayYmd(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function num(v: string | number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function moneyDraft(raw: string): number {
  const t = raw.trim().replace(",", ".");
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function formatSaleDt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function CoursePay({
  draft,
  date,
  pending,
  onDraft,
  onDate,
  onOk,
}: {
  draft: string;
  date: string;
  pending: boolean;
  onDraft: (value: string) => void;
  onDate: (value: string) => void;
  onOk: () => void;
}) {
  return (
    <div className="kpi-pay-pack">
      <input
        type="text"
        inputMode="decimal"
        className="mo-input kpi-pay-pack__input"
        placeholder="Доплата"
        aria-label="Доплата"
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
      />
      <DateField value={date} onChange={onDate} allowClear={false} aria-label="Дата доплаты" />
      <button
        type="button"
        className="kpi-action kpi-action--ok"
        disabled={pending || moneyDraft(draft) <= 0}
        onClick={onOk}
      >
        OK
      </button>
    </div>
  );
}

function ManagerCourses({ seeAll }: { seeAll: boolean }) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [payDraft, setPayDraft] = useState<Record<number, string>>({});
  const [payDates, setPayDates] = useState<Record<number, string>>({});

  const query = useQuery({
    queryKey: ["sales-control-courses"],
    queryFn: () => apiFetch<SalesKpiManualSale[]>("/api/sales-kpi/my-courses"),
  });

  const payMutation = useMutation({
    mutationFn: (body: { id: number; add: number; paid_at: string }) =>
      apiFetch<SalesKpiManualSale>(`/api/sales-kpi/manual-sales/${body.id}/payment`, {
        method: "PATCH",
        body: JSON.stringify({ add_amount: body.add, paid_at: body.paid_at }),
      }),
    onSuccess: (_row, vars) => {
      toast.success("Оплата записана");
      setPayDraft((prev) => ({ ...prev, [vars.id]: "" }));
      void queryClient.invalidateQueries({ queryKey: ["sales-control-courses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = query.data ?? [];
    if (!term) return list;
    return list.filter((s) =>
      [s.client_name, s.client_phone, s.plan_item_name, s.manager_name, s.note]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [query.data, q]);

  return (
    <section className="mo-section space-y-3 p-3 sm:p-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--mo-text)] sm:text-lg">Курсы</h2>
        <p className="mt-1 text-sm lux-caption">
          {seeAll
            ? "Все курсы менеджеров. Сумма, оплата и долг — как в KPI. Доплату можно записать здесь."
            : "Курсы, где вы указаны менеджером продажи. Сумма, оплата и долг — как в KPI. Доплату можно записать здесь."}
        </p>
      </div>
      <label className="flex max-w-md flex-col gap-1 text-xs mo-muted">
        Поиск
        <input
          className="mo-input"
          value={q}
          placeholder="Имя, телефон, курс"
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      {query.isLoading ? <p className="text-sm lux-caption">Загрузка курсов…</p> : null}
      {query.isError ? <p className="text-sm text-red-400">{(query.error as Error).message}</p> : null}
      {!query.isLoading && rows.length === 0 ? (
        <p className="text-sm mo-muted">{seeAll ? "Курсов нет." : "Курсов, проданных вами, нет."}</p>
      ) : null}
      {rows.length > 0 ? (
        <div className="mo-table-scroll rounded-2xl border border-[var(--mo-border)]">
          <table className="kpi-data-table min-w-[980px] text-sm">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Курс</th>
                <th>Поток</th>
                <th>Этап</th>
                {seeAll ? <th>Менеджер</th> : null}
                <th>Пациент</th>
                <th>Телефон</th>
                <th>Сумма</th>
                <th>Оплачено</th>
                <th>Долг</th>
                <th>Оплата</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap tabular-nums">{formatSaleDt(s.sold_at)}</td>
                  <td>{s.plan_item_name}</td>
                  <td className="whitespace-nowrap">{s.group_no ? `Поток ${s.group_no}` : "—"}</td>
                  <td className="whitespace-nowrap">{s.stream_no ? `Этап ${s.stream_no}` : "—"}</td>
                  {seeAll ? <td>{s.manager_name}</td> : null}
                  <td className="font-medium">{s.client_name}</td>
                  <td className="tabular-nums">{s.client_phone || "—"}</td>
                  <td className="tabular-nums whitespace-nowrap">{formatMoney(num(s.service_amount))}</td>
                  <td className="tabular-nums whitespace-nowrap">{formatMoney(num(s.paid_amount))}</td>
                  <td>
                    <span className={["kpi-debt", num(s.debt_amount) <= 0 ? "is-zero" : ""].filter(Boolean).join(" ")}>
                      {formatMoney(num(s.debt_amount))}
                    </span>
                    {s.status === "returned" ? <div className="text-[10px] mo-muted">возврат</div> : null}
                    {s.status === "refused" ? <div className="text-[10px] mo-muted">отказ</div> : null}
                    {s.status === "completed" ? <div className="text-[10px] mo-muted">завершён</div> : null}
                  </td>
                  <td>
                    {s.status === "active" && num(s.debt_amount) > 0 ? (
                      <CoursePay
                        draft={payDraft[s.id] ?? ""}
                        date={payDates[s.id] || todayYmd()}
                        pending={payMutation.isPending}
                        onDraft={(value) => setPayDraft((prev) => ({ ...prev, [s.id]: value }))}
                        onDate={(value) => setPayDates((prev) => ({ ...prev, [s.id]: value }))}
                        onOk={() =>
                          payMutation.mutate({
                            id: s.id,
                            add: moneyDraft(payDraft[s.id] ?? ""),
                            paid_at: payDates[s.id] || todayYmd(),
                          })
                        }
                      />
                    ) : (
                      <span className="text-[var(--mo-text-muted)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function SalesControlPage() {
  const role = decodeRoleFromToken(getStoredToken());
  const seeAll = role === "admin" || role === "owner";
  const [section, setSection] = useState<Section>("protocols");
  if (role !== "manager" && role !== "admin" && role !== "owner") {
    return <AccessDenied message="Контроль продаж открыт менеджеру и админу." />;
  }
  return (
    <div className="mo-page">
      <PageHeader
        title="Контроль продаж"
        description={
          seeAll
            ? "Протоколы — все пациенты. Курсы — продажи всех менеджеров и их оплаты."
            : "Протоколы — ваши пациенты из журнала куратора. Курсы — продажи, где вы менеджер, и их оплаты."
        }
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(
          [
            ["protocols", "Протоколы"],
            ["courses", "Курсы"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={["debtor-chip", section === id ? "is-on" : ""].filter(Boolean).join(" ")}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {section === "protocols" ? <ProtocolQueuePanel enabled /> : <ManagerCourses seeAll={seeAll} />}
    </div>
  );
}
