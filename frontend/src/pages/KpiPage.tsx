import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";

import { AccessDenied } from "@/components/AccessDenied";
import { DebtorPatientCard } from "@/components/DebtorPatientCard";
import { DateField } from "@/components/DateField";
import { KpiLeadPicker, type KpiLeadPick } from "@/components/KpiLeadPicker";
import { MonthYearPicker } from "@/components/MonthYearPicker";
import { ServiceRevenueCharts } from "@/components/ServiceRevenueCharts";
import { PageHeader } from "@/components/ui/PageHeader";
import { useCurrentUserMe } from "@/hooks/useCurrentUserMe";
import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import type {
  Lead,
  SalesKpiCompanyReport,
  SalesKpiDebtorPayment,
  SalesKpiDebtorRow,
  SalesKpiDebtorsReport,
  SalesKpiManualSale,
  SalesKpiPaymentJournalRow,
  SalesKpiPipelineMeta,
  SalesKpiReferralServiceCell,
  SalesKpiServiceEarningsReport,
  SalesKpiServiceRates,
  SalesKpiWeightedPlan,
} from "@/lib/types";

type TabId = "plan" | "sales" | "company" | "manual" | "debtors";

function todayYmd(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function ManualPayPack({
  paid,
  draft,
  date,
  pending,
  onDraft,
  onDate,
  onOk,
  showPaid = true,
}: {
  paid: number;
  draft: string;
  date: string;
  pending: boolean;
  onDraft: (value: string) => void;
  onDate: (value: string) => void;
  onOk: () => void;
  showPaid?: boolean;
}) {
  return (
    <div className="kpi-pay-pack">
      {showPaid ? <span className="kpi-pay-pack__sum">{formatMoney(paid)}</span> : null}
      <input
        type="number"
        min={0}
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
        disabled={pending || !(Number(draft || 0) > 0)}
        onClick={onOk}
      >
        OK
      </button>
    </div>
  );
}

function saleProductKind(name: string | null | undefined): "course" | "protocol" | "other" {
  const n = (name || "").toLowerCase().replace(/ё/g, "е");
  if (n.includes("протокол")) return "protocol";
  if (n.includes("курс")) return "course";
  return "other";
}

function SaleRowActionsMenu({
  onReturn,
  onRefuse,
  onComplete,
}: {
  onReturn: () => void;
  onRefuse: () => void;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if ((e.target as Element | null)?.closest?.(".kpi-actions-menu")) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = 200;
      let left = r.right - w;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      let top = r.bottom + 6;
      if (top + 200 > window.innerHeight - 8) top = Math.max(8, r.top - 200 - 6);
      setPos({ top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const menu =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            role="menu"
            aria-label="Действия по продаже"
            className="kpi-actions-menu"
            style={{ top: pos.top, left: pos.left, width: 168 }}
          >
            <button
              type="button"
              role="menuitem"
              className="kpi-actions-menu__item kpi-actions-menu__item--return"
              onClick={() => {
                setOpen(false);
                onReturn();
              }}
            >
              <span className="kpi-actions-menu__mark" aria-hidden />
              Возврат
            </button>
            <button
              type="button"
              role="menuitem"
              className="kpi-actions-menu__item kpi-actions-menu__item--refuse"
              onClick={() => {
                setOpen(false);
                onRefuse();
              }}
            >
              <span className="kpi-actions-menu__mark" aria-hidden />
              Отказ
            </button>
            <button
              type="button"
              role="menuitem"
              className="kpi-actions-menu__item kpi-actions-menu__item--done"
              onClick={() => {
                setOpen(false);
                onComplete();
              }}
            >
              <span className="kpi-actions-menu__mark" aria-hidden />
              Завершён
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="kpi-actions-wrap">
      <button
        ref={btnRef}
        type="button"
        className="kpi-actions-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Действия"
        onClick={() => setOpen((v) => !v)}
      >
        Действия
        <svg className="kpi-actions-trigger__chev" width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M6 8l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {menu}
    </div>
  );
}

function defaultYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function pctLabel(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function contribLabel(v: string | number): string {
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

function num(v: string | number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function ReferralCountCell({ cell }: { cell: SalesKpiReferralServiceCell }) {
  if (!cell.count) {
    return <td className="py-2 pr-3 mo-muted">0</td>;
  }
  return (
    <td className="py-2 pr-3">
      <div className="tabular-nums font-medium">{cell.count}</div>
      <div className="text-xs mo-muted tabular-nums">{formatMoney(num(cell.paid_amount))}</div>
    </td>
  );
}

const KPI_GROUP_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1);
const KPI_STREAM_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

function groupLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) < 1) return "—";
  return `Поток ${Number(n)}`;
}

function streamLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) < 1) return "—";
  return `Этап ${Number(n)}`;
}

/** Поиск по ФИО, телефону, потоку/этапу, менеджеру (и др. полям строки). */
function matchesKpiListQuery(query: string, parts: Array<string | number | null | undefined>): boolean {
  const raw = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return true;
  const hay = parts
    .filter((x) => x != null && String(x).trim() !== "" && String(x) !== "—")
    .map((x) => String(x).toLowerCase())
    .join(" ");
  const tokens = raw.split(" ").filter(Boolean);
  if (tokens.every((t) => hay.includes(t))) return true;
  const digQ = raw.replace(/\D/g, "");
  if (digQ.length >= 2) {
    const digHay = parts
      .map((x) => String(x ?? "").replace(/\D/g, ""))
      .filter(Boolean)
      .join(" ");
    if (digHay.includes(digQ)) return true;
  }
  return false;
}

function formatSaleDt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function paymentKindLabel(kind: string): string {
  if (kind === "first") return "первый";
  if (kind === "topup") return "доплата";
  return "оплата";
}

function daysSincePayment(iso: string): number | null {
  const stamp = new Date(iso).getTime();
  if (Number.isNaN(stamp)) return null;
  return Math.max(0, Math.floor((Date.now() - stamp) / 86_400_000));
}

function DebtorReceipts({ payments }: { payments: SalesKpiDebtorPayment[] }) {
  if (!payments.length) {
    return <p className="text-[12px] mo-muted">Поступлений ещё нет.</p>;
  }
  const last = payments[0];
  const ago = daysSincePayment(last.paid_at);
  return (
    <div className="space-y-1">
      <p className="text-[11px] mo-muted">
        Последнее: {formatSaleDt(last.paid_at)} · {formatMoney(num(last.amount))}
        {ago != null ? ` · ${ago} дн. назад` : ""}
      </p>
      <ul className="space-y-0.5">
        {payments.map((payment, index) => (
          <li key={`${payment.paid_at}-${index}`} className="flex justify-between gap-3 text-[12px]">
            <span className="text-[var(--mo-text)]">
              {formatSaleDt(payment.paid_at)} · {paymentKindLabel(payment.kind)}
            </span>
            <span className="tabular-nums font-medium text-[var(--mo-text)]">
              {formatMoney(num(payment.amount))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function clinicTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dushanbe",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function DebtorNoteFields({
  comment,
  promisedOn,
  onSave,
}: {
  comment: string | null | undefined;
  promisedOn: string | null | undefined;
  onSave: (comment: string, promisedOn: string) => void;
}) {
  const [text, setText] = useState(comment ?? "");
  const [promised, setPromised] = useState(promisedOn ?? "");
  useEffect(() => {
    setText(comment ?? "");
    setPromised(promisedOn ?? "");
  }, [comment, promisedOn]);
  return (
    <div className="debtor-note">
      <input
        className="mo-input debtor-note__comment"
        aria-label="Комментарий по долгу"
        placeholder="Звонок, что обещал"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== (comment ?? "")) onSave(text, promised);
        }}
      />
      <DateField
        aria-label="Обещал оплатить"
        placeholder="Обещал оплатить"
        value={promised}
        allowClear
        onChange={(iso) => {
          setPromised(iso);
          onSave(text, iso);
        }}
      />
    </div>
  );
}

export function KpiPage() {
  const queryClient = useQueryClient();
  const role = decodeRoleFromToken(getStoredToken());
  const isOwner = role === "owner" || role === "super_owner" || role === "rop";
  const isAdminOrOwner = isOwner || role === "admin" || role === "administrator";
  const isManager = role === "manager";
  const isCurator = role === "curator" || (role === "expert" && Boolean(meQuery.data?.also_curator));
  const isAccountant = role === "accountant";
  const meQuery = useCurrentUserMe();
  const salesSpace =
    meQuery.data?.crm_mode === "sales" || Boolean(meQuery.data?.desk_sales_enabled);

  const [yearMonth, setYearMonth] = useState(defaultYearMonth);
  const [pipelineId, setPipelineId] = useState<number | null>(null);
  const [listQuery, setListQuery] = useState("");
  const [journalSearch, setJournalSearch] = useState("");
  const [journalOpen, setJournalOpen] = useState(false);
  const [saleProductFilter, setSaleProductFilter] = useState<"all" | "course" | "protocol">("all");
  const [tab, setTab] = useState<TabId>(
    isCurator ? "debtors" : isAccountant ? "company" : isOwner ? "plan" : "sales",
  );

  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});

  const [saleForm, setSaleForm] = useState({
    plan_item_id: "",
    manager_user_id: "",
    stream_no: "",
    group_no: "",
    client_name: "",
    client_phone: "",
    service_amount: "",
    paid_amount: "",
    second_paid_amount: "",
    first_paid_at: "",
    second_paid_at: "",
    note: "",
  });
  const [selectedLead, setSelectedLead] = useState<KpiLeadPick | null>(null);
  const [leadFromContext, setLeadFromContext] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [payDraft, setPayDraft] = useState<Record<number, string>>({});
  const [payDates, setPayDates] = useState<Record<number, string>>({});
  const [expandedDebtorKey, setExpandedDebtorKey] = useState<string | null>(null);
  const [patientCard, setPatientCard] = useState<SalesKpiDebtorRow | null>(null);
  const [debtorManager, setDebtorManager] = useState<string | null>(null);

  const pipelinesQuery = useQuery({
    queryKey: ["sales-kpi-pipelines"],
    queryFn: () => apiFetch<SalesKpiPipelineMeta[]>("/api/sales-kpi/pipelines"),
    enabled: role !== "expert" || Boolean(meQuery.data?.also_curator),
  });

  useEffect(() => {
    const list = pipelinesQuery.data ?? [];
    if (!list.length) return;
    if (pipelineId == null || !list.some((x) => x.id === pipelineId)) {
      setPipelineId(list[0].id);
    }
  }, [pipelinesQuery.data, pipelineId]);

  useEffect(() => {
    if (role === "expert" && meQuery.data?.also_curator) setTab("debtors");
  }, [role, meQuery.data?.also_curator]);

  // Phase 8B: create-from-Lead — ?lead_id= → auto-select, open manual tab
  useEffect(() => {
    if (!isAdminOrOwner) return;
    const raw = searchParams.get("lead_id");
    if (!raw) return;
    const lid = Number(raw);
    if (!Number.isFinite(lid) || lid < 1) return;
    let cancelled = false;
    void (async () => {
      try {
        const lead = await apiFetch<Lead>(`/api/leads/${lid}`);
        if (cancelled) return;
        setSelectedLead({
          lead_id: lead.id,
          name: lead.name,
          phone: lead.phone ?? null,
        });
        setLeadFromContext(true);
        setSaleForm((s) => ({
          ...s,
          client_name: lead.name || s.client_name,
          client_phone: (lead.phone || "").trim() || s.client_phone,
        }));
        setTab("manual");
        const next = new URLSearchParams(searchParams);
        next.delete("lead_id");
        setSearchParams(next, { replace: true });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Lead не найден");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot from URL
  }, [isAdminOrOwner]);

  const qs = useMemo(() => {
    if (!pipelineId) return "";
    const p = new URLSearchParams();
    p.set("pipeline_id", String(pipelineId));
    p.set("year_month", yearMonth);
    return p.toString();
  }, [pipelineId, yearMonth]);

  const planQuery = useQuery({
    queryKey: ["sales-kpi-weighted-plan", qs],
    queryFn: () => apiFetch<SalesKpiWeightedPlan>(`/api/sales-kpi/weighted-plan?${qs}`),
    enabled: Boolean(pipelineId && (isOwner || isAdminOrOwner || isManager) && !isCurator),
  });

  const ratesQuery = useQuery({
    queryKey: ["sales-kpi-service-rates", qs],
    queryFn: () => apiFetch<SalesKpiServiceRates>(`/api/sales-kpi/service-rates?${qs}`),
    enabled: Boolean(pipelineId && isOwner && tab === "plan"),
  });

  const earningsQuery = useQuery({
    queryKey: ["sales-kpi-service-earnings", qs],
    queryFn: () => apiFetch<SalesKpiServiceEarningsReport>(`/api/sales-kpi/service-earnings?${qs}`),
    enabled: Boolean(pipelineId && tab === "sales" && !isCurator),
  });

  const manualQuery = useQuery({
    queryKey: ["sales-kpi-manual-sales", qs],
    queryFn: () => apiFetch<SalesKpiManualSale[]>(`/api/sales-kpi/manual-sales?${qs}`),
    enabled: Boolean(pipelineId && isAdminOrOwner && tab === "manual"),
  });

  const programRequestsQuery = useQuery({
    queryKey: ["sales-kpi-program-requests"],
    queryFn: () =>
      apiFetch<
        {
          id: number;
          lead_id: number | null;
          program_kind: string;
          program_label: string;
          patient_name: string;
          patient_phone: string;
          manager_user_id?: number | null;
          manager_name?: string | null;
        }[]
      >("/api/sales-kpi/program-requests"),
    enabled: Boolean(isAdminOrOwner && tab === "manual"),
  });

  const paymentJournalQuery = useQuery({
    queryKey: ["sales-kpi-payment-journal", pipelineId],
    queryFn: () =>
      apiFetch<SalesKpiPaymentJournalRow[]>(
        `/api/sales-kpi/manual-sales/payments?pipeline_id=${pipelineId}`,
      ),
    enabled: Boolean(pipelineId && isAdminOrOwner && tab === "manual" && journalOpen),
  });

  useEffect(() => {
    if (!journalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setJournalOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [journalOpen]);

  const debtorsQuery = useQuery({
    queryKey: ["sales-kpi-debtors", qs],
    queryFn: () => apiFetch<SalesKpiDebtorsReport>(`/api/sales-kpi/debtors?${qs}`),
    enabled: Boolean(pipelineId && (isAdminOrOwner || isCurator) && tab === "debtors"),
  });

  const debtorNoteMutation = useMutation({
    mutationFn: (body: { source: string; source_id: number; comment: string; promised_on: string }) =>
      apiFetch("/api/sales-kpi/debtors/note", {
        method: "PUT",
        body: JSON.stringify({
          source: body.source,
          source_id: body.source_id,
          comment: body.comment.trim() || null,
          promised_on: body.promised_on || null,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-debtors"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const companyQuery = useQuery({
    queryKey: ["sales-kpi-company-report", qs],
    queryFn: () =>
      apiFetch<SalesKpiCompanyReport>(`/api/sales-kpi/company-report?${qs}`, {
        timeoutMs: 60_000,
      }),
    enabled: Boolean(pipelineId && (isOwner || isAccountant) && tab === "company"),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!ratesQuery.data) return;
    const next: Record<string, string> = {};
    for (const row of ratesQuery.data.items) {
      const n = num(row.manager_percent);
      next[row.service_key] = n > 0 ? String(n) : "";
    }
    setRateDraft(next);
  }, [ratesQuery.data]);

  const saveRatesMutation = useMutation({
    mutationFn: async () => {
      if (!pipelineId) throw new Error("Выберите воронку");
      const items = (ratesQuery.data?.items ?? []).map((row) => {
        const raw = (rateDraft[row.service_key] ?? "").trim().replace(",", ".");
        const percent = raw === "" ? 0 : Number(raw);
        if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
          throw new Error(`Процент для «${row.name}» — число от 0 до 100`);
        }
        return { service_key: row.service_key, manager_percent: percent };
      });
      await apiFetch<void>("/api/sales-kpi/service-rates", {
        method: "PUT",
        body: JSON.stringify({ pipeline_id: pipelineId, items }),
      });
    },
    onSuccess: () => {
      toast.success("Проценты сохранены");
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-service-rates"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-service-earnings"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-company-report"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createSaleMutation = useMutation({
    mutationFn: async () => {
      if (!pipelineId) throw new Error("Выберите воронку");
      if (!saleForm.stream_no) throw new Error("Укажите этап");
      if (!saleForm.group_no) throw new Error("Укажите поток");
      const clientName = saleForm.client_name.trim() || selectedLead?.name?.trim() || "";
      const clientPhone = saleForm.client_phone.trim() || selectedLead?.phone?.trim() || "";
      if (!clientName) throw new Error("Укажите имя клиента или выберите пациента");
      if (!clientPhone) throw new Error("Укажите телефон или выберите пациента с телефоном");
      await apiFetch<SalesKpiManualSale>("/api/sales-kpi/manual-sales", {
        method: "POST",
        body: JSON.stringify({
          pipeline_id: pipelineId,
          plan_item_id: Number(saleForm.plan_item_id),
          manager_user_id: Number(saleForm.manager_user_id),
          stream_no: Number(saleForm.stream_no),
          group_no: Number(saleForm.group_no),
          client_name: clientName,
          client_phone: clientPhone,
          lead_id: selectedLead?.lead_id ?? null,
          service_amount: Number(saleForm.service_amount),
          paid_amount: Number(saleForm.paid_amount || 0),
          second_paid_amount: Number(saleForm.second_paid_amount || 0),
          first_paid_at: saleForm.first_paid_at || null,
          second_paid_at: saleForm.second_paid_at || null,
          note: saleForm.note.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      toast.success(
        selectedLead
          ? `Продажа добавлена · #${selectedLead.lead_id}`
          : "Продажа добавлена без привязки к пациенту",
      );
      setSaleForm({
        plan_item_id: "",
        manager_user_id: "",
        stream_no: "",
        group_no: "",
        client_name: "",
        client_phone: "",
        service_amount: "",
        paid_amount: "",
        second_paid_amount: "",
        first_paid_at: "",
        second_paid_at: "",
        note: "",
      });
      setSelectedLead(null);
      setLeadFromContext(false);
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-manual-sales"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-sales-report"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-debtors"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-payment-journal"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-company-report"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-program-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dismissRequestMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/sales-kpi/program-requests/${id}/dismiss`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Заявка снята");
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-program-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function fillFromCuratorRequest(req: {
    lead_id: number | null;
    program_kind: string;
    program_label: string;
    patient_name: string;
    patient_phone: string;
    manager_user_id?: number | null;
    manager_name?: string | null;
  }) {
    const item = (planQuery.data?.items ?? [])
      .filter((it) => it.source_type === "manual")
      .find((it) => {
        const n = it.name.toLowerCase();
        if (req.program_kind === "protocol") return n.includes("протокол");
        return n.includes("курс") && !n.includes("15");
      });
    if (req.lead_id) {
      setSelectedLead({
        lead_id: req.lead_id,
        name: req.patient_name,
        phone: req.patient_phone,
        manager_name: req.manager_name,
      });
      setLeadFromContext(true);
    } else {
      setSelectedLead(null);
      setLeadFromContext(false);
    }
    setSaleForm((s) => ({
      ...s,
      client_name: req.patient_name,
      client_phone: req.patient_phone,
      plan_item_id: item ? String(item.id) : s.plan_item_id,
      manager_user_id: req.manager_user_id ? String(req.manager_user_id) : s.manager_user_id,
    }));
  }

  const linkLeadMutation = useMutation({
    mutationFn: async ({ id, leadId }: { id: number; leadId: number }) => {
      await apiFetch<SalesKpiManualSale>(`/api/sales-kpi/manual-sales/${id}/link-lead`, {
        method: "PATCH",
        body: JSON.stringify({ lead_id: leadId }),
      });
    },
    onSuccess: () => {
      toast.success("Lead привязан");
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-manual-sales"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics-ltv-cohort"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const payMutation = useMutation({
    mutationFn: async ({ id, add, paid_at }: { id: number; add: number; paid_at: string }) => {
      await apiFetch<SalesKpiManualSale>(`/api/sales-kpi/manual-sales/${id}/payment`, {
        method: "PATCH",
        body: JSON.stringify({ add_amount: add, paid_at: paid_at || todayYmd() }),
      });
    },
    onSuccess: () => {
      toast.success("Доплата записана в журнал");
      setPayDraft({});
      setPayDates({});
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-manual-sales"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-sales-report"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-debtors"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-payment-journal"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-company-report"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const returnMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiFetch<SalesKpiManualSale>(`/api/sales-kpi/manual-sales/${id}/return`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    onSuccess: () => {
      toast.success("Возврат отмечен — снято с KPI");
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-manual-sales"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-sales-report"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-debtors"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-payment-journal"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeSaleMutation = useMutation({
    mutationFn: async ({
      id,
      status,
      reason,
    }: {
      id: number;
      status: "refused" | "completed";
      reason: string;
    }) => {
      await apiFetch<SalesKpiManualSale>(`/api/sales-kpi/manual-sales/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, reason }),
      });
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.status === "refused" ? "Статус: отказ" : "Статус: завершён");
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-manual-sales"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-sales-report"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-debtors"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-payment-journal"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function askCloseSale(id: number, status: "refused" | "completed") {
    const label = status === "refused" ? "отказ" : "завершён";
    const reason = window.prompt(`Причина статуса «${label}» (обязательно):`)?.trim() ?? "";
    if (!reason) {
      toast.error("Укажите причину");
      return;
    }
    closeSaleMutation.mutate({ id, status, reason });
  }

  if (role === "expert" || role === "finance_analyst") {
    return <AccessDenied message="Раздел KPI недоступен для вашей роли." />;
  }

  const tabs: { id: TabId; label: string; shortLabel: string; show: boolean }[] = [
    { id: "plan", label: "Услуги", shortLabel: "Услуги", show: isOwner },
    {
      id: "sales",
      label: "Продажи",
      shortLabel: "Продажи",
      show: (isOwner || isAdminOrOwner || isManager) && !isCurator && !isAccountant,
    },
    { id: "company", label: "Отчёт компании", shortLabel: "Отчёт", show: isOwner || isAccountant },
    { id: "manual", label: "Курсы / протоколы", shortLabel: "Курсы", show: isAdminOrOwner },
    {
      id: "debtors",
      label: isCurator ? "Дебиторка курсов / протоколов" : "Дебиторка",
      shortLabel: "Долги",
      show: isAdminOrOwner || isCurator,
    },
  ];

  const manualPlanItems = (planQuery.data?.items ?? []).filter((x) => x.source_type === "manual");
  const managers = planQuery.data?.managers ?? [];

  const filteredJournal = useMemo(() => {
    const rows = paymentJournalQuery.data ?? [];
    const q = journalSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.client_name, r.client_phone, r.plan_item_name, r.manager_name, r.recorded_by_name, r.note, String(r.amount)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [paymentJournalQuery.data, journalSearch]);

  const filteredManualSales = useMemo(() => {
    let rows = manualQuery.data ?? [];
    if (saleProductFilter !== "all") {
      rows = rows.filter((s) => saleProductKind(s.plan_item_name) === saleProductFilter);
    }
    if (!listQuery.trim()) return rows;
    return rows.filter((s) =>
      matchesKpiListQuery(listQuery, [
        s.client_name,
        s.client_phone,
        s.manager_name,
        s.plan_item_name,
        groupLabel(s.group_no),
        streamLabel(s.stream_no),
        s.group_no,
        s.stream_no,
        s.note,
      ]),
    );
  }, [manualQuery.data, listQuery, saleProductFilter]);

  const debtorManagers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of debtorsQuery.data?.rows ?? []) {
      const name = row.manager_name?.trim() || "Без менеджера";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"));
  }, [debtorsQuery.data?.rows]);

  const filteredDebtors = useMemo(() => {
    let rows = debtorsQuery.data?.rows ?? [];
    if (debtorManager) {
      rows = rows.filter((r) => (r.manager_name?.trim() || "Без менеджера") === debtorManager);
    }
    if (!listQuery.trim()) return rows;
    return rows.filter((r) =>
      matchesKpiListQuery(listQuery, [
        r.client_name,
        r.client_phone,
        r.manager_name,
        r.indicator_name,
        r.comment,
        r.source === "booking" ? "запись" : "курс",
      ]),
    );
  }, [debtorManager, debtorsQuery.data?.rows, listQuery]);

  const clinicToday = clinicTodayYmd();
  const callTodayCount = filteredDebtors.filter((r) => Boolean(r.promised_on) && (r.promised_on as string) <= clinicToday).length;
  const debtorsScoped = Boolean(listQuery.trim() || debtorManager);
  const visibleTabs = tabs.filter((t) => t.show);

  return (
    <div
      className={[
        "sales-space-page relative mx-auto w-full max-w-none space-y-2 sm:space-y-5 sm:pb-10",
        tab === "plan" && isOwner ? "pb-[6.5rem]" : "pb-4",
      ].join(" ")}
    >
      <header className="mo-admin-page-head !border-b-0 pb-0 sm:border-b sm:pb-3">
        <PageHeader
          className="mb-0"
          title="KPI продаж"
          description="У каждой услуги свой процент. Заработок — этот процент от суммы, которую менеджер привёл по ней."
        />
      </header>

      <section className="kpi-toolbar grid grid-cols-2 gap-1.5 rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] px-2 py-1.5 sm:grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_minmax(0,12rem)] sm:gap-2 sm:rounded-2xl sm:px-2.5 sm:py-2">
        <label className="order-1 flex min-w-0 flex-col gap-0.5 text-[10px] font-medium leading-tight mo-muted sm:text-[11px]">
          Месяц
          <MonthYearPicker compact value={yearMonth} onChange={setYearMonth} className="kpi-toolbar__control" />
        </label>
        <label className="order-3 col-span-2 flex min-w-0 flex-col gap-0.5 text-[10px] font-medium leading-tight mo-muted sm:order-2 sm:col-span-1 sm:text-[11px]">
          Поиск
          <input
            type="search"
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
            placeholder="ФИО, телефон, поток, менеджер"
            className="mo-input kpi-toolbar__control min-w-0"
            autoComplete="off"
          />
        </label>
        <label className="order-2 flex min-w-0 flex-col gap-0.5 text-[10px] font-medium leading-tight mo-muted sm:order-3 sm:text-[11px]">
          Воронка
          <select
            value={pipelineId ?? ""}
            onChange={(e) => setPipelineId(Number(e.target.value) || null)}
            className="mo-input kpi-toolbar__control truncate"
          >
            {(pipelinesQuery.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="kpi-tabs" role="tablist" aria-label="Разделы KPI">
        {visibleTabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              title={t.label}
              onClick={() => setTab(t.id)}
              className={active ? "kpi-tabs__btn is-active" : "kpi-tabs__btn"}
            >
              <span className="kpi-tabs__label kpi-tabs__label--full">{t.label}</span>
              <span className="kpi-tabs__label kpi-tabs__label--short">{t.shortLabel}</span>
            </button>
          );
        })}
      </div>

      {tab === "plan" && isOwner ? (
        <section className="mo-section space-y-3 p-3 sm:space-y-4 sm:p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[var(--mo-text)] sm:text-lg">Услуги</h2>
              <p className="mt-1 text-sm lux-caption">
                У каждой услуги свой процент, включая курс и протокол. Пустое поле — ноль.
                Заработок считается от приведённой суммы, без порога.
              </p>
            </div>
            <button
              type="button"
              onClick={() => saveRatesMutation.mutate()}
              disabled={saveRatesMutation.isPending}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {saveRatesMutation.isPending ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
          {ratesQuery.isLoading ? <p className="text-sm lux-caption">Загрузка услуг…</p> : null}
          {ratesQuery.isError ? (
            <p className="text-sm text-red-300">{(ratesQuery.error as Error).message}</p>
          ) : null}
          {!ratesQuery.isLoading && (ratesQuery.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm lux-caption">В этой воронке нет услуг.</p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(ratesQuery.data?.items ?? []).map((row) => (
              <label key={row.service_key} className="flex flex-col gap-1 text-sm">
                <span className="truncate font-medium text-[var(--mo-text)]">{row.name}</span>
                <span className="text-[11px] mo-muted">Процент менеджера</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="mo-input"
                  value={rateDraft[row.service_key] ?? ""}
                  onChange={(e) =>
                    setRateDraft((prev) => ({ ...prev, [row.service_key]: e.target.value }))
                  }
                  placeholder="%"
                  autoComplete="off"
                />
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "sales" ? (
        <SalesReportSection
          data={earningsQuery.data}
          loading={earningsQuery.isLoading}
          error={earningsQuery.error as Error | null}
          listQuery={listQuery}
        />
      ) : null}

      {tab === "company" && (isOwner || isAccountant) ? (
        <CompanyReportSection
          data={companyQuery.data}
          loading={companyQuery.isLoading}
          error={companyQuery.error as Error | null}
          hideBookingExperts={salesSpace}
        />
      ) : null}

      {tab === "manual" && isAdminOrOwner ? (
        <section className="mo-section space-y-3 p-3 sm:space-y-4 sm:p-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--mo-text)] sm:text-lg">Продажа курса / протокола</h2>
            <p className="mt-1 text-[11px] leading-snug text-[var(--mo-text-muted)] sm:text-sm">
              Процент этой услуги берётся из вкладки «Услуги». В заработок идёт сумма, которую менеджер привёл, без порога. Остаток попадает в дебиторку через месяц после первой оплаты.
            </p>
          </div>

          {(programRequestsQuery.data ?? []).length > 0 ? (
            <div className="space-y-2 rounded-xl border border-[var(--mo-border)] p-3">
              <p className="text-sm font-semibold text-[var(--mo-text)]">От куратора — подтвердить и принять оплату</p>
              <p className="text-[11px] mo-muted">
                Имя из онлайн-записи. Сумму, поток, этап и платежи заполняет админ в форме ниже.
              </p>
              <ul className="space-y-2">
                {(programRequestsQuery.data ?? []).map((req) => (
                  <li
                    key={req.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--mo-border)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{req.patient_name}</p>
                      <p className="text-[11px] tabular-nums mo-muted">
                        {req.patient_phone || "—"}
                        {req.lead_id ? ` · #${req.lead_id}` : ""} · {req.program_label}
                        {req.manager_name ? ` · ${req.manager_name}` : ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-primary px-3 py-1.5 text-xs"
                        onClick={() => fillFromCuratorRequest(req)}
                      >
                        В форму
                      </button>
                      <button
                        type="button"
                        className="btn-secondary px-3 py-1.5 text-xs"
                        disabled={dismissRequestMutation.isPending}
                        onClick={() => dismissRequestMutation.mutate(req.id)}
                      >
                        Не продаём
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {manualPlanItems.length === 0 ? (
            <p className="text-sm text-amber-200/90">
              {salesSpace
                ? "Сначала владелец должен добавить продукты во вкладке «План»."
                : "Сначала владелец должен добавить продукты с источником «Курс / протокол» во вкладке «План»."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
              <label className="col-span-2 flex flex-col gap-1 text-[11px] mo-muted sm:col-span-1 sm:text-sm">
                Продукт
                <select
                  className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                  value={saleForm.plan_item_id}
                  onChange={(e) => setSaleForm((s) => ({ ...s, plan_item_id: e.target.value }))}
                >
                  <option value="">—</option>
                  {manualPlanItems.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-[11px] mo-muted sm:col-span-1 sm:text-sm">
                Менеджер
                <select
                  className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                  value={saleForm.manager_user_id}
                  onChange={(e) => setSaleForm((s) => ({ ...s, manager_user_id: e.target.value }))}
                >
                  <option value="">—</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] mo-muted sm:text-sm">
                Поток
                <select
                  className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                  value={saleForm.group_no}
                  onChange={(e) => setSaleForm((s) => ({ ...s, group_no: e.target.value }))}
                  title="Поток — время образования"
                >
                  <option value="">—</option>
                  {KPI_GROUP_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      Поток {n}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] leading-snug text-[var(--mo-text-muted)]">
                  курс: один номер — один поток куратора
                </span>
              </label>
              <label className="flex flex-col gap-1 text-[11px] mo-muted sm:text-sm">
                Этап
                <select
                  className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                  value={saleForm.stream_no}
                  onChange={(e) => setSaleForm((s) => ({ ...s, stream_no: e.target.value }))}
                  title="Этап — номер платежа"
                >
                  <option value="">—</option>
                  {KPI_STREAM_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      Этап {n}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] leading-snug text-[var(--mo-text-muted)]">номер платежа</span>
              </label>
              <label className="flex flex-col gap-1 text-[11px] mo-muted sm:text-sm">
                Клиент
                <input
                  className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                  value={saleForm.client_name}
                  onChange={(e) => setSaleForm((s) => ({ ...s, client_name: e.target.value }))}
                />
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-[11px] mo-muted sm:col-span-1 sm:text-sm">
                Телефон
                <input
                  className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                  inputMode="tel"
                  value={saleForm.client_phone}
                  onChange={(e) => setSaleForm((s) => ({ ...s, client_phone: e.target.value }))}
                />
              </label>
              <KpiLeadPicker
                selected={selectedLead}
                lockedFromContext={leadFromContext}
                onSelect={(lead) => {
                  setSelectedLead(lead);
                  setLeadFromContext(false);
                  if (lead) {
                    setSaleForm((s) => ({
                      ...s,
                      client_name: lead.name || s.client_name,
                      client_phone: (lead.phone || "").trim() || s.client_phone,
                    }));
                  }
                }}
              />
              <div className="kpi-sale-pays col-span-2 lg:col-span-4">
                <label className="flex flex-col gap-1 text-[11px] mo-muted sm:text-sm">
                  Стоимость
                  <input
                    type="number"
                    min={0}
                    inputMode="decimal"
                    className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                    value={saleForm.service_amount}
                    onChange={(e) => setSaleForm((s) => ({ ...s, service_amount: e.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] mo-muted sm:text-sm">
                  Первый платёж
                  <input
                    type="number"
                    min={0}
                    inputMode="decimal"
                    className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                    value={saleForm.paid_amount}
                    onChange={(e) => setSaleForm((s) => ({ ...s, paid_amount: e.target.value }))}
                  />
                </label>
                <label className="kpi-sale-pays__date flex flex-col gap-1 text-[11px] mo-muted sm:text-sm">
                  Дата 1-го
                  <DateField
                    value={saleForm.first_paid_at}
                    onChange={(v) => setSaleForm((s) => ({ ...s, first_paid_at: v }))}
                    aria-label="Дата первого платежа"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] mo-muted sm:text-sm">
                  Второй платёж
                  <input
                    type="number"
                    min={0}
                    inputMode="decimal"
                    className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                    value={saleForm.second_paid_amount}
                    onChange={(e) => setSaleForm((s) => ({ ...s, second_paid_amount: e.target.value }))}
                  />
                </label>
                <label className="kpi-sale-pays__date flex flex-col gap-1 text-[11px] mo-muted sm:text-sm">
                  Дата 2-го
                  <DateField
                    value={saleForm.second_paid_at}
                    onChange={(v) => setSaleForm((s) => ({ ...s, second_paid_at: v }))}
                    aria-label="Дата второго платежа"
                  />
                </label>
                <p className="kpi-sale-pays__hint">
                  пусто → сегодня; выручка по месяцу даты, KPI менеджера — только 1-й платёж
                </p>
              </div>
              <label className="col-span-2 flex flex-col gap-1 text-[11px] mo-muted sm:text-sm lg:col-span-4">
                Комментарий
                <input
                  className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                  value={saleForm.note}
                  onChange={(e) => setSaleForm((s) => ({ ...s, note: e.target.value }))}
                />
              </label>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary min-h-12 w-full text-base disabled:opacity-50 sm:min-h-0 sm:w-auto sm:text-sm"
              disabled={createSaleMutation.isPending || manualPlanItems.length === 0}
              onClick={() => createSaleMutation.mutate()}
            >
              Добавить продажу
            </button>
            <button
              type="button"
              className="btn-secondary min-h-12 w-full text-base sm:min-h-0 sm:w-auto sm:text-sm"
              onClick={() => setJournalOpen(true)}
            >
              Журнал платежей
            </button>
          </div>

          {journalOpen && typeof document !== "undefined"
            ? createPortal(
                <div
                  className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4"
                  onClick={() => setJournalOpen(false)}
                >
                  <div
                    className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] shadow-2xl sm:rounded-2xl"
                    role="dialog"
                    aria-modal
                    aria-label="Журнал платежей"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <header className="flex items-start justify-between gap-3 border-b border-[var(--mo-border)] px-4 py-3">
                      <div>
                        <h2 className="text-base font-semibold text-[var(--mo-text)] sm:text-lg">Журнал платежей</h2>
                        <p className="mt-0.5 text-xs mo-muted">Когда, кто внёс и сколько.</p>
                      </div>
                      <button
                        type="button"
                        className="btn-secondary min-h-11 px-3 text-sm"
                        onClick={() => setJournalOpen(false)}
                      >
                        Закрыть
                      </button>
                    </header>
                    <div className="border-b border-[var(--mo-border)] px-4 py-3">
                      <label className="flex flex-col gap-1 text-[11px] mo-muted sm:text-sm">
                        Поиск
                        <input
                          className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                          value={journalSearch}
                          placeholder="Имя, телефон, кто внёс, сумма"
                          onChange={(e) => setJournalSearch(e.target.value)}
                          autoFocus
                        />
                      </label>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                      <ul className="space-y-2 sm:hidden">
                        {filteredJournal.map((r) => (
                          <li
                            key={`${r.sale_id}-${r.payment_id ?? "first"}-${r.paid_at}`}
                            className="rounded-xl border border-[var(--mo-border)] px-3 py-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="truncate text-sm font-semibold text-[var(--mo-text)]">{r.client_name}</p>
                              <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(num(r.amount))}</span>
                            </div>
                            <p className="text-[11px] text-[var(--mo-text-muted)]">
                              {formatSaleDt(r.paid_at)} · {r.plan_item_name}
                              {r.is_first ? " · первый" : " · доплата"}
                            </p>
                            <p className="text-[11px] text-[var(--mo-text-muted)]">
                              Внёс: {r.recorded_by_name || "—"} · менеджер {r.manager_name}
                            </p>
                          </li>
                        ))}
                      </ul>
                      <div className="hidden overflow-x-auto sm:block">
                        <table className="kpi-data-table min-w-[760px] text-sm">
                          <thead>
                            <tr>
                              <th>Дата</th>
                              <th>Клиент</th>
                              <th>Услуга</th>
                              <th>Сумма</th>
                              <th>Кто внёс</th>
                              <th>Менеджер</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredJournal.map((r) => (
                              <tr key={`${r.sale_id}-${r.payment_id ?? "first"}-${r.paid_at}`}>
                                <td className="whitespace-nowrap tabular-nums">{formatSaleDt(r.paid_at)}</td>
                                <td className="font-medium">{r.client_name}</td>
                                <td>
                                  {r.plan_item_name}
                                  <span className="ml-1 text-[11px] text-[var(--mo-text-muted)]">
                                    {r.is_first ? "первый" : "доплата"}
                                  </span>
                                </td>
                                <td className="tabular-nums whitespace-nowrap">{formatMoney(num(r.amount))}</td>
                                <td>{r.recorded_by_name || "—"}</td>
                                <td>{r.manager_name}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {paymentJournalQuery.isLoading ? <p className="text-sm lux-caption">Загрузка журнала…</p> : null}
                      {!paymentJournalQuery.isLoading && filteredJournal.length === 0 ? (
                        <p className="text-sm lux-caption">В журнале ничего не найдено.</p>
                      ) : null}
                    </div>
                  </div>
                </div>,
                document.body,
              )
            : null}

          <div className="flex flex-wrap gap-1.5 pt-1">
            {(
              [
                ["all", "Все"],
                ["course", "Курсы"],
                ["protocol", "Протоколы"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={["debtor-chip", saleProductFilter === id ? "is-on" : ""].filter(Boolean).join(" ")}
                onClick={() => setSaleProductFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <ul className="space-y-2 pt-1 sm:hidden">
            {filteredManualSales.map((s) => (
              <li key={s.id} className="kpi-sale-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--mo-text)]">{s.client_name}</p>
                    <p className="truncate text-[11px] text-[var(--mo-text-muted)]">
                      {s.plan_item_name} · {groupLabel(s.group_no)} · {streamLabel(s.stream_no)}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-[var(--mo-text-muted)]">
                    {s.sold_at
                      ? new Date(s.sold_at).toLocaleDateString("ru-RU", {
                          day: "2-digit",
                          month: "2-digit",
                        })
                      : "—"}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--mo-text-muted)]">{s.manager_name}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--mo-text)]">
                  <span className="tabular-nums">
                    {formatMoney(num(s.paid_amount))} / {formatMoney(num(s.service_amount))}
                  </span>
                  {s.status === "returned" ? (
                    <span className="kpi-chip kpi-chip--return">возврат</span>
                  ) : s.status === "refused" ? (
                    <span className="kpi-chip kpi-chip--refuse">отказ</span>
                  ) : s.status === "completed" ? (
                    <span className="kpi-chip kpi-chip--done">завершён</span>
                  ) : null}
                </div>
                {s.status === "active" && num(s.debt_amount) > 0 ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <ManualPayPack
                      paid={num(s.paid_amount)}
                      draft={payDraft[s.id] ?? ""}
                      date={payDates[s.id] || todayYmd()}
                      pending={payMutation.isPending}
                      onDraft={(value) => setPayDraft((prev) => ({ ...prev, [s.id]: value }))}
                      onDate={(value) => setPayDates((prev) => ({ ...prev, [s.id]: value }))}
                      onOk={() =>
                        payMutation.mutate({
                          id: s.id,
                          add: Number(payDraft[s.id] || 0),
                          paid_at: payDates[s.id] || todayYmd(),
                        })
                      }
                    />
                    <SaleRowActionsMenu
                      onReturn={() => {
                        if (window.confirm("Отметить возврат и снять с KPI?")) {
                          returnMutation.mutate(s.id);
                        }
                      }}
                      onRefuse={() => askCloseSale(s.id, "refused")}
                      onComplete={() => askCloseSale(s.id, "completed")}
                    />
                  </div>
                ) : s.status === "active" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <SaleRowActionsMenu
                      onReturn={() => {
                        if (window.confirm("Отметить возврат и снять с KPI?")) {
                          returnMutation.mutate(s.id);
                        }
                      }}
                      onRefuse={() => askCloseSale(s.id, "refused")}
                      onComplete={() => askCloseSale(s.id, "completed")}
                    />
                  </div>
                ) : s.status_reason ? (
                  <p className="mt-1 text-[11px] text-[var(--mo-text-muted)]">Причина: {s.status_reason}</p>
                ) : null}
              </li>
            ))}
            {!manualQuery.isLoading && listQuery.trim() && filteredManualSales.length === 0 ? (
              <p className="text-sm lux-caption">Ничего не найдено по запросу «{listQuery.trim()}».</p>
            ) : null}
            {manualQuery.isLoading ? <p className="text-sm lux-caption">Загрузка…</p> : null}
          </ul>

          <div className="hidden overflow-x-auto pt-2 sm:block">
            <table className="kpi-data-table min-w-[1100px] text-sm">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Продукт</th>
                  <th>Поток</th>
                  <th>Этап</th>
                  <th>Менеджер</th>
                  <th>Клиент</th>
                  <th>Телефон</th>
                  <th>Сумма</th>
                  <th>Оплачено</th>
                  <th>Долг</th>
                  <th>KPI</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {filteredManualSales.map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap tabular-nums">
                      {s.sold_at ? formatSaleDt(s.sold_at) : "—"}
                    </td>
                    <td>{s.plan_item_name}</td>
                    <td className="whitespace-nowrap">{groupLabel(s.group_no)}</td>
                    <td className="whitespace-nowrap">{streamLabel(s.stream_no)}</td>
                    <td>{s.manager_name}</td>
                    <td className="font-medium">{s.client_name}</td>
                    <td className="tabular-nums">{s.client_phone}</td>
                    <td className="tabular-nums whitespace-nowrap">
                      <div className="kpi-sum-pay">
                        <span className="kpi-pay-pack__sum">{formatMoney(num(s.service_amount))}</span>
                        {s.status === "active" && num(s.debt_amount) > 0 ? (
                          <ManualPayPack
                            showPaid={false}
                            paid={num(s.paid_amount)}
                            draft={payDraft[s.id] ?? ""}
                            date={payDates[s.id] || todayYmd()}
                            pending={payMutation.isPending}
                            onDraft={(value) => setPayDraft((prev) => ({ ...prev, [s.id]: value }))}
                            onDate={(value) => setPayDates((prev) => ({ ...prev, [s.id]: value }))}
                            onOk={() =>
                              payMutation.mutate({
                                id: s.id,
                                add: Number(payDraft[s.id] || 0),
                                paid_at: payDates[s.id] || todayYmd(),
                              })
                            }
                          />
                        ) : null}
                      </div>
                    </td>
                    <td className="tabular-nums whitespace-nowrap">{formatMoney(num(s.paid_amount))}</td>
                    <td>
                      <span className={["kpi-debt", num(s.debt_amount) <= 0 ? "is-zero" : ""].filter(Boolean).join(" ")}>
                        {formatMoney(num(s.debt_amount))}
                      </span>
                    </td>
                    <td>
                      {s.status === "returned" ? (
                        <span className="kpi-chip kpi-chip--return">возврат</span>
                      ) : s.status === "refused" ? (
                        <span className="kpi-chip kpi-chip--refuse">отказ</span>
                      ) : s.status === "completed" ? (
                        <span className="kpi-chip kpi-chip--done">завершён</span>
                      ) : null}
                      {s.status_reason ? (
                        <div className="mt-0.5 max-w-[10rem] truncate text-[10px] text-[var(--mo-text-muted)]" title={s.status_reason}>
                          {s.status_reason}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div className="flex flex-col gap-1">
                        {s.lead_id ? (
                          <span className="text-[10px] tabular-nums mo-muted">Lead #{s.lead_id}</span>
                        ) : (role === "owner" || role === "super_owner") ? (
                          <button
                            type="button"
                            className="text-left text-[11px] text-[var(--mo-accent-hover)] underline"
                            disabled={linkLeadMutation.isPending}
                            onClick={() => {
                              const raw = window.prompt("Lead ID для явной привязки (без phone-merge):");
                              const leadId = Number(raw || 0);
                              if (!leadId) return;
                              linkLeadMutation.mutate({ id: s.id, leadId });
                            }}
                          >
                            Привязать Lead
                          </button>
                        ) : (
                          <span className="text-[10px] mo-muted">без Lead</span>
                        )}
                        {s.status === "active" ? (
                          <SaleRowActionsMenu
                            onReturn={() => {
                              if (window.confirm("Отметить возврат и снять с KPI?")) {
                                returnMutation.mutate(s.id);
                              }
                            }}
                            onRefuse={() => askCloseSale(s.id, "refused")}
                            onComplete={() => askCloseSale(s.id, "completed")}
                          />
                        ) : (
                          <span className="text-[var(--mo-text-muted)]">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!manualQuery.isLoading && listQuery.trim() && filteredManualSales.length === 0 ? (
              <p className="mt-2 text-sm lux-caption">Ничего не найдено по запросу «{listQuery.trim()}».</p>
            ) : null}
            {manualQuery.isLoading ? <p className="mt-2 text-sm lux-caption">Загрузка…</p> : null}
          </div>
        </section>
      ) : null}

      {tab === "debtors" && (isAdminOrOwner || isCurator) ? (
        <section className="mo-section space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[var(--mo-text)] sm:text-lg">Дебиторка</h2>
              <p className="mt-1 text-sm text-[var(--mo-text)]">
                Звонить сегодня: <span className="font-semibold tabular-nums">{callTodayCount}</span>
              </p>
              <p className="mt-1 hidden text-sm lux-caption sm:block">
                Комментарий и дата «обещал оплатить» пишет куратор. Красным — только если эта дата уже прошла.
                Сверху те, кому звонить сегодня. Сумма долга от пометки не меняется.
              </p>
            </div>
            <p className="text-xs mo-muted sm:text-sm">
              Итого
              {debtorsScoped ? " (фильтр)" : ""}:{" "}
              <span className="font-semibold text-[var(--mo-text)]">
                {formatMoney(
                  debtorsScoped
                    ? filteredDebtors.reduce((sum, r) => sum + num(r.debt_amount), 0)
                    : num(debtorsQuery.data?.total_debt),
                )}
              </span>
            </p>
          </div>

          {debtorManagers.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={["debtor-chip", debtorManager ? "" : "is-on"].filter(Boolean).join(" ")}
                onClick={() => setDebtorManager(null)}
              >
                Все
              </button>
              {debtorManagers.map(([name, count]) => (
                <button
                  key={name}
                  type="button"
                  className={["debtor-chip", debtorManager === name ? "is-on" : ""].filter(Boolean).join(" ")}
                  onClick={() => setDebtorManager(debtorManager === name ? null : name)}
                >
                  {name} · {count}
                </button>
              ))}
            </div>
          ) : null}

          <ul className="space-y-2 sm:hidden">
            {filteredDebtors.map((r) => {
              const key = `${r.source}-${r.source_id}`;
              const open = expandedDebtorKey === key;
              const saveNote = (comment: string, promisedOn: string) => {
                debtorNoteMutation.mutate({
                  source: r.source,
                  source_id: r.source_id,
                  comment,
                  promised_on: promisedOn,
                });
              };
              return (
                <li
                  key={key}
                  className={[
                    "overflow-hidden rounded-xl border border-[var(--mo-border)]",
                    r.promise_overdue ? "is-overdue" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div className="flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left">
                    <div className="min-w-0">
                      <button
                        type="button"
                        className="truncate text-sm font-semibold text-[var(--mo-text)] underline-offset-2 hover:underline"
                        onClick={() => setPatientCard(r)}
                      >
                        {r.client_name}
                      </button>
                      <p className="truncate text-[11px] mo-muted">
                        {r.source === "booking" ? "Запись" : "Курс"} · {r.indicator_name}
                      </p>
                      <p className="truncate text-[11px] mo-muted">
                        {(r.payments ?? [])[0]
                          ? `${formatSaleDt((r.payments ?? [])[0].paid_at)} · ${formatMoney(num((r.payments ?? [])[0].amount))}`
                          : "поступлений нет"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 text-right"
                      aria-expanded={open}
                      onClick={() => setExpandedDebtorKey(open ? null : key)}
                    >
                      <span className="block text-sm font-semibold tabular-nums kpi-actual-value">
                        {formatMoney(num(r.debt_amount))}
                      </span>
                      <span className="mt-0.5 block text-[10px] mo-muted">{open ? "Скрыть ▲" : "Подробнее ▼"}</span>
                    </button>
                  </div>
                  {open ? (
                    <div className="space-y-1.5 border-t border-[var(--mo-border)] bg-[var(--mo-surface)]/40 px-3 py-2.5 text-[12px]">
                      <div className="flex justify-between gap-2">
                        <span className="mo-muted">Источник</span>
                        <span className="text-[var(--mo-text)]">
                          {r.source === "booking" ? "Запись" : "Курс/протокол"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="mo-muted">Дата</span>
                        <span className="tabular-nums text-[var(--mo-text)]">
                          {r.sold_at ? formatSaleDt(r.sold_at) : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="mo-muted">Телефон</span>
                        <span className="tabular-nums text-[var(--mo-text)]">{r.client_phone || "—"}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="mo-muted">Услуга</span>
                        <span className="max-w-[65%] text-right text-[var(--mo-text)]">{r.indicator_name}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="mo-muted">Менеджер</span>
                        <span className="max-w-[65%] text-right text-[var(--mo-text)]">
                          {r.manager_name ?? "—"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="mo-muted">Сумма</span>
                        <span className="tabular-nums text-[var(--mo-text)]">
                          {formatMoney(num(r.service_amount))}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="mo-muted">Оплачено</span>
                        <span className="tabular-nums text-[var(--mo-text)]">
                          {formatMoney(num(r.paid_amount))}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2 border-t border-[var(--mo-border)] pt-1.5 font-semibold">
                        <span className="text-[var(--mo-text)]">Долг</span>
                        <span className="tabular-nums kpi-actual-value">
                          {formatMoney(num(r.debt_amount))}
                        </span>
                      </div>
                      <div className="border-t border-[var(--mo-border)] pt-1.5">
                        <p className="mb-1 font-semibold text-[var(--mo-text)]">Поступления</p>
                        <DebtorReceipts payments={r.payments ?? []} />
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-between gap-2 border-t border-[var(--mo-border)]/60 px-3 py-1.5 text-[11px] mo-muted">
                      <span className="truncate">{r.manager_name ?? "—"}</span>
                      <span className="tabular-nums">
                        {formatMoney(num(r.paid_amount))} / {formatMoney(num(r.service_amount))}
                      </span>
                    </div>
                  )}
                  <div className="border-t border-[var(--mo-border)] px-3 py-2">
                    {r.promise_overdue ? <p className="mb-1 text-[11px] font-semibold text-red-400">Просрочено</p> : null}
                    {!r.promise_overdue && r.promised_on === clinicToday ? (
                      <p className="mb-1 text-[11px] font-semibold text-[var(--mo-text)]">Сегодня</p>
                    ) : null}
                    <DebtorNoteFields comment={r.comment} promisedOn={r.promised_on} onSave={saveNote} />
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-x-auto sm:block">
            <table className="kpi-data-table min-w-[1180px] text-sm">
              <thead>
                <tr>
                  <th className="py-2 pr-3">Источник</th>
                  <th className="py-2 pr-3">Дата</th>
                  <th className="py-2 pr-3">Клиент</th>
                  <th className="py-2 pr-3">Телефон</th>
                  <th className="py-2 pr-3">Услуга</th>
                  <th className="py-2 pr-3">Менеджер</th>
                  <th className="py-2 pr-3">Сумма</th>
                  <th className="py-2 pr-3">Оплачено</th>
                  <th className="py-2 pr-3">Долг</th>
                  <th className="py-2 pr-3">Сбор</th>
                </tr>
              </thead>
              <tbody>
                {filteredDebtors.map((r) => {
                  const key = `${r.source}-${r.source_id}`;
                  const open = expandedDebtorKey === key;
                  const lastPay = (r.payments ?? [])[0];
                  return (
                  <Fragment key={key}>
                  <tr className={r.promise_overdue ? "is-overdue" : undefined}>
                    <td className="py-2 pr-3">{r.source === "booking" ? "Запись" : "Курс/протокол"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {r.sold_at ? formatSaleDt(r.sold_at) : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        className="text-left font-medium text-[var(--mo-text)] underline-offset-2 hover:underline"
                        onClick={() => setPatientCard(r)}
                      >
                        {r.client_name}
                      </button>
                      <button
                        type="button"
                        className="mt-0.5 block text-left text-[11px] mo-muted underline-offset-2 hover:underline"
                        aria-expanded={open}
                        onClick={() => setExpandedDebtorKey(open ? null : key)}
                      >
                        {lastPay
                          ? `${formatSaleDt(lastPay.paid_at)} · ${formatMoney(num(lastPay.amount))}`
                          : "поступлений нет"}
                      </button>
                    </td>
                    <td className="py-2 pr-3">
                      {r.client_phone ? (
                        <a className="tabular-nums text-[var(--mo-text)] underline-offset-2 hover:underline" href={`tel:${r.client_phone}`}>
                          {r.client_phone}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3">{r.indicator_name}</td>
                    <td className="py-2 pr-3">{r.manager_name ?? "—"}</td>
                    <td className="py-2 pr-3">{formatMoney(num(r.service_amount))}</td>
                    <td className="py-2 pr-3">{formatMoney(num(r.paid_amount))}</td>
                    <td className="py-2 pr-3 kpi-actual-value">{formatMoney(num(r.debt_amount))}</td>
                    <td className="py-2 pr-3">
                      {r.promise_overdue ? <p className="mb-1 text-[11px] font-semibold text-red-400">Просрочено</p> : null}
                      {!r.promise_overdue && r.promised_on === clinicToday ? (
                        <p className="mb-1 text-[11px] font-semibold text-[var(--mo-text)]">Сегодня</p>
                      ) : null}
                      <DebtorNoteFields
                        comment={r.comment}
                        promisedOn={r.promised_on}
                        onSave={(comment, promisedOn) =>
                          debtorNoteMutation.mutate({
                            source: r.source,
                            source_id: r.source_id,
                            comment,
                            promised_on: promisedOn,
                          })
                        }
                      />
                    </td>
                  </tr>
                  {open ? (
                    <tr>
                      <td colSpan={10} className="bg-[var(--mo-surface)]/50 px-3 py-2">
                        <p className="mb-1 text-[12px] font-semibold text-[var(--mo-text)]">Поступления</p>
                        <DebtorReceipts payments={r.payments ?? []} />
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!debtorsQuery.isLoading && listQuery.trim() && filteredDebtors.length === 0 ? (
            <p className="text-sm lux-caption">Ничего не найдено по запросу «{listQuery.trim()}».</p>
          ) : null}
          {debtorsQuery.isLoading ? <p className="text-sm lux-caption">Загрузка…</p> : null}
          {debtorsQuery.isError ? (
            <p className="text-sm text-red-300">{(debtorsQuery.error as Error).message}</p>
          ) : null}
        </section>
      ) : null}

      {(pipelinesQuery.isLoading || ratesQuery.isLoading) && tab === "plan" ? (
        <p className="text-sm lux-caption">Загрузка…</p>
      ) : null}
      {planQuery.isError ? (
        <p className="text-sm text-red-300">{(planQuery.error as Error).message}</p>
      ) : null}
      {patientCard ? <DebtorPatientCard row={patientCard} onClose={() => setPatientCard(null)} /> : null}
    </div>
  );
}

function SalesReportSection({
  data,
  loading,
  error,
  listQuery = "",
}: {
  data: SalesKpiServiceEarningsReport | undefined;
  loading: boolean;
  error: Error | null;
  listQuery?: string;
}) {
  if (loading) return <p className="text-sm lux-caption">Загрузка заработка…</p>;
  if (error) return <p className="text-sm text-red-300">{error.message}</p>;
  if (!data) return null;

  if (!data.managers.length) {
    return (
      <section className="mo-section p-4">
        <h2 className="lux-subheading">Заработок</h2>
        <p className="mt-2 text-sm lux-caption">
          Нет активных менеджеров на воронке. Назначьте менеджеров — блоки появятся автоматически.
        </p>
      </section>
    );
  }

  const managers = listQuery.trim()
    ? data.managers.filter((m) =>
        matchesKpiListQuery(listQuery, [
          m.manager_name,
          ...m.lines.map((line) => line.name),
        ]),
      )
    : data.managers;

  if (!managers.length) {
    return (
      <section className="mo-section p-4">
        <h2 className="lux-subheading">Заработок</h2>
        <p className="mt-2 text-sm lux-caption">Ничего не найдено по запросу «{listQuery.trim()}».</p>
      </section>
    );
  }

  return (
    <div className="kpi-sales-board">
      <section className="mo-section px-3 py-2">
        <h2 className="text-[15px] font-semibold text-[var(--mo-text)]">Заработок · {data.year_month}</h2>
        <p className="mt-0.5 text-[11px] lux-caption">
          Новых — продажи, открытые в этом месяце. Привёл — полная оплата минус возврат. Итого{" "}
          {formatMoney(num(data.total_earning))}
        </p>
      </section>

      <div className="kpi-sales-grid">
      {managers.map((m) => (
        <section key={m.manager_id} className="kpi-sales-card mo-section">
          <h3 className="kpi-sales-card__name">{m.manager_name}</h3>
          {m.lines.length === 0 ? (
            <p className="text-sm lux-caption">В этом месяце нет услуг. Проценты задаются во вкладке «Услуги».</p>
          ) : (
            <>
              <ul className="kpi-sales-compact lg:hidden">
                {m.lines.map((line) => (
                  <li key={line.service_key}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="min-w-0 truncate text-[13px] font-semibold leading-tight text-[var(--mo-text)]">
                        {line.name}
                      </p>
                      <span className="shrink-0 text-[12px] font-semibold tabular-nums text-[var(--mo-text)]">
                        {formatMoney(num(line.earning))}
                      </span>
                    </div>
                    <p className="text-[11px] leading-tight tabular-nums mo-muted">
                      новых {line.sales_count} · привёл {formatMoney(num(line.brought))} · {num(line.manager_percent)}%
                    </p>
                  </li>
                ))}
                <li className="kpi-sales-compact__total">
                  <span>Итого · новых {m.total_sales}</span>
                  <span className="kpi-actual-value">{formatMoney(num(m.total_earning))}</span>
                </li>
              </ul>
              <div className="hidden lg:block">
                <table className="kpi-data-table w-full text-sm">
                  <thead>
                    <tr>
                      <th>Услуга</th>
                      <th>Новых</th>
                      <th>Привёл</th>
                      <th>%</th>
                      <th>Заработок</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.lines.map((line) => (
                      <tr key={line.service_key}>
                        <td>{line.name}</td>
                        <td className="tabular-nums">{line.sales_count}</td>
                        <td>{formatMoney(num(line.brought))}</td>
                        <td>{num(line.manager_percent)}</td>
                        <td>{formatMoney(num(line.earning))}</td>
                      </tr>
                    ))}
                    <tr className="kpi-matrix-row-highlight">
                      <td className="font-semibold">Итого</td>
                      <td className="font-semibold tabular-nums">{m.total_sales}</td>
                      <td colSpan={2} />
                      <td className="font-semibold kpi-actual-value">{formatMoney(num(m.total_earning))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ))}
      </div>
    </div>
  );
}

function CompanyReportSection({
  data,
  loading,
  error,
  hideBookingExperts = false,
}: {
  data: SalesKpiCompanyReport | undefined;
  loading: boolean;
  error: Error | null;
  hideBookingExperts?: boolean;
}) {
  if (loading) {
    return (
      <p className="text-sm lux-caption">
        Загрузка отчёта компании… Считаем записи и продажи за месяц — обычно 5–20 сек.
      </p>
    );
  }
  if (error) return <p className="text-sm text-red-300">{error.message}</p>;
  if (!data) return null;

  return (
    <div className="space-y-4 sm:space-y-6">
      <section className="mo-section p-3 sm:p-4">
        <h2 className="text-base font-semibold text-[var(--mo-text)] sm:text-lg">
          Отчёт компании · {data.year_month}
        </h2>
        <p className="mt-1 hidden text-sm lux-caption sm:block">
          {hideBookingExperts
            ? "Сводка за выбранный месяц (не сумма с прошлых). Выручка = продажи стола + платежи по курсам с датой в этом месяце. Дебиторка — остаток на конец месяца с переносом."
            : "Сводка за месяц. Выручка = оплаты визитов по дате сдачи денег (как ОСВ). Курсы KPI показаны отдельно и в эту сумму не входят. Дебиторка = остаток визитов + долги пакетов."}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-3 lg:grid-cols-5">
          <div className="rounded-xl border border-[var(--mo-border)] p-2.5 sm:p-3">
            <div className="text-[11px] mo-muted sm:text-xs">Выполнение плана</div>
            <div className="mt-1 text-xl font-semibold text-[var(--mo-text)] sm:text-2xl">
              {num(data.plan_completion_percent).toFixed(1)}%
            </div>
            {data.days_in_month ? (
              <div className="mt-1 text-[10px] mo-muted sm:text-xs">
                день {data.days_elapsed ?? 0} из {data.days_in_month} (
                {num(data.month_progress_percent).toFixed(0)}% месяца)
              </div>
            ) : null}
          </div>
          <div className="rounded-xl border border-[var(--mo-border)] p-2.5 sm:p-3">
            <div className="text-[11px] mo-muted sm:text-xs">Выручка (TJS)</div>
            <div className="mt-1 text-xl font-semibold kpi-actual-value sm:text-2xl">
              {formatMoney(data.revenue_total)}
            </div>
            <div className="mt-1 text-[10px] mo-muted sm:text-xs">
              {hideBookingExperts
                ? `стол ${formatMoney(data.revenue_booking)} · курсы ${formatMoney(data.revenue_manual)}`
                : `визиты ${formatMoney(data.revenue_booking)}${
                    Number(data.revenue_manual) > 0
                      ? ` · курсы KPI ${formatMoney(data.revenue_manual)} отдельно`
                      : ""
                  }`}
            </div>
          </div>
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-2.5 sm:p-3">
            <div className="text-[11px] mo-muted sm:text-xs">Возвраты (TJS)</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-rose-700 sm:text-2xl dark:text-rose-300">
              {formatMoney(data.refunds_total ?? 0)}
            </div>
            <div className="mt-1 text-[10px] mo-muted sm:text-xs">
              {hideBookingExperts
                ? `стол ${formatMoney(data.refunds_booking ?? 0)} · курсы ${formatMoney(data.refunds_manual ?? 0)}`
                : `визиты ${formatMoney(data.refunds_booking ?? 0)} · курсы ${formatMoney(data.refunds_manual ?? 0)}`}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--mo-border)] p-2.5 sm:p-3">
            <div className="text-[11px] mo-muted sm:text-xs">Дебиторка (остаток)</div>
            <div className="mt-1 text-xl font-semibold text-amber-600 sm:text-2xl dark:text-amber-200">
              {formatMoney(data.debtor_total)}
            </div>
            <div className="mt-1 text-[10px] mo-muted sm:text-xs">
              {hideBookingExperts
                ? `запись ${formatMoney(data.debtor_booking)} · курсы ${formatMoney(data.debtor_manual)}`
                : `визиты ${formatMoney(data.debtor_booking)} · курсы ${formatMoney(data.debtor_manual)}`}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--mo-border)] p-2.5 sm:p-3">
            <div className="text-[11px] mo-muted sm:text-xs">Кредиторка</div>
            <div className="mt-1 text-xl font-semibold text-[var(--mo-text)] sm:text-2xl">
              {formatMoney(data.creditor_total)}
            </div>
            <div className="mt-1 hidden text-xs mo-muted sm:block">оплачено, срок визита ещё не наступил</div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)]/50 p-4">
          <h3 className="text-sm font-semibold text-[var(--mo-text)]">Ориентир при % плана</h3>
          <p className="mt-1 text-xs mo-muted">
            Грубо: факт выручки × (цель % / текущий %). Это не касса и не прогноз банка — только
            линейная оценка от выполнения плана по продуктам. При низком % плана блок скрыт.
          </p>
          {data.revenue_at_plan_100_percent == null ? (
            <p className="mt-3 text-sm lux-caption">
              Нет оценки (нужны выручка и достаточный % плана; при &lt;20% экстраполяция на 100% не
              показывается).
            </p>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 sm:col-span-2 lg:col-span-1">
                <div className="text-[11px] font-medium text-emerald-200">При 100% плана</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--mo-text)]">
                  {formatMoney(data.revenue_at_plan_100_percent)}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--mo-border)] p-3">
                <div className="text-[11px] mo-muted">Сейчас факт</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-[var(--mo-text)]">
                  {num(data.plan_completion_percent).toFixed(1)}% · {formatMoney(data.revenue_total)}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--mo-border)] p-3">
                <div className="text-[11px] mo-muted">При 25%</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-[var(--mo-text)]">
                  {formatMoney(data.revenue_at_plan_25_percent)}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--mo-border)] p-3">
                <div className="text-[11px] mo-muted">При 50%</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-[var(--mo-text)]">
                  {formatMoney(data.revenue_at_plan_50_percent)}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-[var(--mo-border)] p-4">
          <h3 className="text-sm font-semibold text-[var(--mo-text)]">Прогноз на конец месяца</h3>
          <p className="mt-1 text-xs mo-muted">{data.forecast_note || "—"}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs mo-muted">Прогноз выполнения плана</div>
              <div className="mt-1 text-2xl font-semibold text-[var(--mo-text)]">
                {data.forecast_plan_completion_percent == null
                  ? "—"
                  : `${num(data.forecast_plan_completion_percent).toFixed(1)}%`}
              </div>
            </div>
            <div>
              <div className="text-xs mo-muted">Прогноз выручки</div>
              <div className="mt-1 text-2xl font-semibold kpi-actual-value">
                {data.forecast_revenue == null ? "—" : formatMoney(data.forecast_revenue)}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-3 text-sm mo-muted">
          Заработок менеджеров по услугам:{" "}
          <span className="font-medium text-[var(--mo-text)]">
            {formatMoney(data.managers_sales_bonus_total)}
          </span>
        </p>
      </section>

      <section className="mo-section p-4">
        <h3 className="mb-1 text-lg font-semibold text-[var(--mo-text)]">План компании по продуктам</h3>
        <p className="mb-3 text-xs mo-muted">
          Колонка «План» — сумма планов всех менеджеров по продукту (как во вкладке «Продажи»).
        </p>
        {data.plan_lines.length === 0 ? (
          <p className="text-sm lux-caption">План на месяц не задан.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="kpi-data-table min-w-[800px] text-sm">
              <thead>
                <tr>
                  <th className="py-2 pr-3">Продукт</th>
                  <th className="py-2 pr-3">План</th>
                  <th className="py-2 pr-3">Вес %</th>
                  <th className="py-2 pr-3">Факт</th>
                  <th className="py-2 pr-3">Выполн.</th>
                  <th className="py-2 pr-3">Вклад %</th>
                </tr>
              </thead>
              <tbody>
                {data.plan_lines.map((line) => (
                  <tr key={line.plan_item_id}>
                    <td className="py-2 pr-3">{line.name}</td>
                    <td className="py-2 pr-3">{line.plan_qty}</td>
                    <td className="py-2 pr-3">{num(line.weight_percent)}</td>
                    <td className="py-2 pr-3">{line.fact_qty}</td>
                    <td className="py-2 pr-3">{pctLabel(line.completion)}</td>
                    <td className="py-2 pr-3">{contribLabel(line.contribution)}</td>
                  </tr>
                ))}
                <tr className="kpi-matrix-row-highlight">
                  <td className="py-2 pr-3 font-semibold" colSpan={5}>
                    ИТОГО вклад / % плана
                  </td>
                  <td className="py-2 pr-3 font-semibold">
                    {contribLabel(data.total_contribution)} · {num(data.plan_completion_percent).toFixed(1)}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!hideBookingExperts ? (
      <>
      <ServiceRevenueCharts services={data.service_stats ?? []} experts={data.expert_stats} />
      <section className="mo-section p-4">
        <h3 className="mb-3 text-lg font-semibold text-[var(--mo-text)]">По услугам</h3>
        <p className="mb-3 text-sm lux-caption">
          Отдельно: Курс, Курс 15, Протокол, Массаж и т.д. — итог по всей клинике за месяц.
        </p>
        <div className="overflow-x-auto">
          <table className="kpi-data-table min-w-[1100px] text-sm">
            <thead>
              <tr>
                <th className="py-2 pr-3">Услуга</th>
                <th className="py-2 pr-3">Записей</th>
                <th className="py-2 pr-3">Явились</th>
                <th className="py-2 pr-3">Не явились</th>
                <th className="py-2 pr-3">Ещё booked</th>
                <th className="py-2 pr-3">Оплачено полностью</th>
                <th className="py-2 pr-3">Оплачено при неявке</th>
                <th className="py-2 pr-3">Всего оплат</th>
                <th className="py-2 pr-3">Дебиторка</th>
              </tr>
            </thead>
            <tbody>
              {(data.service_stats ?? []).map((s) => (
                <tr key={s.direction_id ?? s.direction_name}>
                  <td className="py-2 pr-3 font-medium">{s.direction_name}</td>
                  <td className="py-2 pr-3">{s.appointments_total}</td>
                  <td className="py-2 pr-3">{s.appeared_count}</td>
                  <td className="py-2 pr-3">{s.no_show_count}</td>
                  <td className="py-2 pr-3">{s.booked_count ?? 0}</td>
                  <td className="py-2 pr-3">{formatMoney(s.paid_full_amount ?? 0)}</td>
                  <td className="py-2 pr-3">{formatMoney(s.paid_no_show_amount ?? 0)}</td>
                  <td className="py-2 pr-3">{formatMoney(s.revenue_paid)}</td>
                  <td className="py-2 pr-3">{formatMoney(s.debtor_amount ?? 0)}</td>
                </tr>
              ))}
              {(data.service_stats ?? []).length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-3 mo-muted">
                    Нет записей за месяц
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mo-section p-4">
        <h3 className="mb-3 text-lg font-semibold text-[var(--mo-text)]">По экспертам</h3>
        <p className="mb-3 text-sm lux-caption">
          Сводка по специалисту (все его услуги вместе). Детализация по услугам — в таблице выше.
        </p>
        <div className="overflow-x-auto">
          <table className="kpi-data-table min-w-[1000px] text-sm">
            <thead>
              <tr>
                <th className="py-2 pr-3">Эксперт</th>
                <th className="py-2 pr-3">Записей</th>
                <th className="py-2 pr-3">Явились</th>
                <th className="py-2 pr-3">Не явились</th>
                <th className="py-2 pr-3">Оплачено полностью</th>
                <th className="py-2 pr-3">Оплачено при неявке</th>
                <th className="py-2 pr-3">Всего оплат</th>
                <th className="py-2 pr-3">Дебиторка</th>
                <th className="py-2 pr-3">Кредиторка</th>
              </tr>
            </thead>
            <tbody>
              {data.expert_stats.map((e) => (
                <tr key={e.specialist_id}>
                  <td className="py-2 pr-3">
                    <div>{e.specialist_name}</div>
                    {e.kpi_service_name ? (
                      <div className="text-xs mo-muted">KPI: {e.kpi_service_name}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">{e.appointments_total}</td>
                  <td className="py-2 pr-3">{e.appeared_count}</td>
                  <td className="py-2 pr-3">{e.no_show_count}</td>
                  <td className="py-2 pr-3">{formatMoney(e.paid_full_amount ?? 0)}</td>
                  <td className="py-2 pr-3">{formatMoney(e.paid_no_show_amount ?? 0)}</td>
                  <td className="py-2 pr-3">{formatMoney(e.revenue_paid)}</td>
                  <td className="py-2 pr-3">{formatMoney(e.debtor_amount)}</td>
                  <td className="py-2 pr-3">{formatMoney(e.creditor_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mo-section p-4">
        <h3 className="mb-3 text-lg font-semibold text-[var(--mo-text)]">По направлениям</h3>
        <p className="mb-3 text-sm lux-caption">
          Визит попадает, если статус «пришёл», дата в этом месяце и оплата больше нуля. В «Направил»
          стоит этот врач. Число — сколько раз направил, под ним — оплаченная сумма. Подарочный массаж
          и ТМС не входят. Логомассаж и курсы не входят.
        </p>
        <div className="overflow-x-auto">
          <table className="kpi-data-table min-w-[900px] text-sm">
            <thead>
              <tr>
                <th className="py-2 pr-3">Врач</th>
                <th className="py-2 pr-3">Остеопатия · 3%</th>
                <th className="py-2 pr-3">ТМС · 5%</th>
                <th className="py-2 pr-3">Анализы · 5%</th>
                <th className="py-2 pr-3">Массаж · 5%</th>
                <th className="py-2 pr-3">Начисление</th>
              </tr>
            </thead>
            <tbody>
              {(data.referral_rows ?? []).map((row) => (
                <tr key={row.user_id}>
                  <td className="py-2 pr-3 font-medium">{row.full_name}</td>
                  <ReferralCountCell cell={row.osteopath} />
                  <ReferralCountCell cell={row.tms} />
                  <ReferralCountCell cell={row.lab} />
                  <ReferralCountCell cell={row.massage} />
                  <td className="py-2 pr-3 tabular-nums">{formatMoney(num(row.accrual_total))}</td>
                </tr>
              ))}
              {(data.referral_rows ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-3 mo-muted">
                    За этот месяц направлений нет
                  </td>
                </tr>
              ) : (
                <tr className="kpi-matrix-row-highlight">
                  <td className="py-2 pr-3 font-semibold">Итого</td>
                  <td className="py-2 pr-3 font-semibold tabular-nums">
                    {(data.referral_rows ?? []).reduce((sum, row) => sum + row.osteopath.count, 0)}
                  </td>
                  <td className="py-2 pr-3 font-semibold tabular-nums">
                    {(data.referral_rows ?? []).reduce((sum, row) => sum + row.tms.count, 0)}
                  </td>
                  <td className="py-2 pr-3 font-semibold tabular-nums">
                    {(data.referral_rows ?? []).reduce((sum, row) => sum + row.lab.count, 0)}
                  </td>
                  <td className="py-2 pr-3 font-semibold tabular-nums">
                    {(data.referral_rows ?? []).reduce((sum, row) => sum + row.massage.count, 0)}
                  </td>
                  <td className="py-2 pr-3 font-semibold tabular-nums">
                    {formatMoney(
                      (data.referral_rows ?? []).reduce((sum, row) => sum + num(row.accrual_total), 0),
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      </>
      ) : null}
    </div>
  );
}
