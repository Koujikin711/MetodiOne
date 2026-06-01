import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { TerminateWithLeadsWizard } from "@/components/TerminateWithLeadsWizard";
import { Button } from "@/components/ui/Button";
import { apiFetch, getStoredToken } from "@/lib/api";
import { theme } from "@/lib/theme";
import { decodeUserIdFromToken } from "@/lib/auth";
import type { BookingDirection, Pipeline, UserRole } from "@/lib/types";

type HorecaRole = "waiter" | "hall_admin" | "cook" | "cashier";
const HORECA_ROLE_LABEL: Record<HorecaRole, string> = {
  waiter: "Официант",
  hall_admin: "Админ зала",
  cook: "Повар",
  cashier: "Кассир",
};

export interface Employee {
  id: number;
  email: string;
  phone: string | null;
  full_name: string | null;
  role: UserRole;
  horeca_role?: HorecaRole | null;
  pipeline_ids: number[];
  specialization?: string | null;
  booking_direction_id?: number | null;
}

interface InviteResult {
  employee: Employee;
  invite_url: string;
  temp_password_sent_to_email: boolean;
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  from_email: string;
  has_password: boolean;
  public_app_url: string;
  public_api_base_url: string;
}

interface RedistributionSource {
  manager_id: number;
  manager_name: string;
  lead_count: number;
  is_active: boolean;
}

interface RedistributionPreview {
  from_manager_id: number;
  from_manager_name: string;
  lead_count: number;
}

interface RedistributeResult {
  total: number;
  reassigned: number;
  per_manager: Record<string, number>;
}

export function EmployeesPage() {
  const qc = useQueryClient();
  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => apiFetch<Employee[]>("/api/employees"),
  });
  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiFetch<Pipeline[]>("/api/pipelines"),
  });
  const bookingDirectionsQuery = useQuery({
    queryKey: ["booking-directions"],
    queryFn: () => apiFetch<BookingDirection[]>("/api/booking/directions"),
  });
  const smtpQuery = useQuery({
    queryKey: ["smtp-config"],
    queryFn: () => apiFetch<SmtpConfig>("/api/system/smtp"),
  });
  const [smtpTestEmail, setSmtpTestEmail] = useState("");
  const smtpTestMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>("/api/system/smtp/test", {
        method: "POST",
        body: JSON.stringify({ to_email: smtpTestEmail }),
      }),
    onSuccess: () => toast.success("Тестовое письмо отправлено"),
    onError: (e: Error) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<UserRole>("manager");
  const [horecaRole, setHorecaRole] = useState<HorecaRole | "">("");
  const [pipelineIds, setPipelineIds] = useState<number[]>([]);
  const [expertSpecialization, setExpertSpecialization] = useState("");
  const [bookingDirectionId, setBookingDirectionId] = useState<number | "">("");
  const [terminateTarget, setTerminateTarget] = useState<Employee | null>(null);
  const [editPipelinesEmployee, setEditPipelinesEmployee] = useState<Employee | null>(null);
  const [editPipelineIds, setEditPipelineIds] = useState<number[]>([]);

  const pipelines = pipelinesQuery.data ?? [];
  const bookingDirections = bookingDirectionsQuery.data ?? [];
  const pipelineById = useMemo(() => new Map(pipelines.map((p) => [p.id, p])), [pipelines]);

  const myUserId = useMemo(() => decodeUserIdFromToken(getStoredToken()), []);

  const activeSalesManagers = useMemo(
    () =>
      (employeesQuery.data ?? []).filter((e) => e.role === "manager" || e.role === "admin"),
    [employeesQuery.data],
  );

  const [redistributeFromId, setRedistributeFromId] = useState<number | "">("");
  const [redistributeToIds, setRedistributeToIds] = useState<number[]>([]);

  const redistributionSourcesQuery = useQuery({
    queryKey: ["leads-redistribution-sources"],
    queryFn: () => apiFetch<RedistributionSource[]>("/api/leads/redistribution/sources"),
  });

  const redistributionSources = redistributionSourcesQuery.data ?? [];
  const sourcesWithLeads = useMemo(
    () => redistributionSources.filter((s) => s.lead_count > 0),
    [redistributionSources],
  );

  const selectedSource = useMemo(
    () =>
      redistributeFromId === ""
        ? undefined
        : redistributionSources.find((s) => s.manager_id === redistributeFromId),
    [redistributionSources, redistributeFromId],
  );

  const redistributionPreviewQuery = useQuery({
    queryKey: ["leads-redistribution-preview", redistributeFromId],
    queryFn: () =>
      apiFetch<RedistributionPreview>(
        `/api/leads/redistribution/preview?from_manager_id=${redistributeFromId}`,
      ),
    enabled: redistributeFromId !== "",
  });

  const redistributeMutation = useMutation({
    mutationFn: () =>
      apiFetch<RedistributeResult>("/api/leads/redistribute", {
        method: "POST",
        body: JSON.stringify({
          from_manager_id: redistributeFromId,
          to_manager_ids: redistributeToIds,
        }),
      }),
    onSuccess: (r) => {
      const parts = Object.entries(r.per_manager)
        .map(([id, cnt]) => {
          const emp = activeSalesManagers.find((e) => e.id === Number(id));
          const label = emp?.full_name ?? emp?.email ?? `#${id}`;
          return `${label}: ${cnt}`;
        })
        .join(", ");
      toast.success(
        parts
          ? `Перераспределено ${r.reassigned} лид(ов). ${parts}`
          : `Перераспределено ${r.reassigned} лид(ов)`,
      );
      setRedistributeFromId("");
      setRedistributeToIds([]);
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["leads-table"] });
      void qc.invalidateQueries({ queryKey: ["leads-redistribution-sources"] });
      void qc.invalidateQueries({ queryKey: ["chat-threads"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function toggleRedistributeTarget(id: number) {
    setRedistributeToIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function confirmRedistribute() {
    if (redistributeFromId === "" || redistributeToIds.length === 0) {
      toast.error("Выберите менеджера-источник и хотя бы одного получателя");
      return;
    }
    const srcLabel = selectedSource?.manager_name ?? `#${redistributeFromId}`;
    const cnt =
      redistributionPreviewQuery.data?.lead_count ?? selectedSource?.lead_count ?? 0;
    if (cnt <= 0) {
      toast.error("У выбранного менеджера нет лидов для передачи");
      return;
    }
    const targets = redistributeToIds
      .map((id) => {
        const e = activeSalesManagers.find((x) => x.id === id);
        return e?.full_name ?? e?.email ?? `#${id}`;
      })
      .join(", ");
    if (
      !window.confirm(
        `Передать все ${cnt} лид(ов) от «${srcLabel}» менеджерам: ${targets}?\n\nЧат и открытые задачи по этим клиентам перейдут к новым ответственным; им придёт уведомление.`,
      )
    ) {
      return;
    }
    redistributeMutation.mutate();
  }

  useEffect(() => {
    if (!open || role !== "expert" || bookingDirections.length === 0 || bookingDirectionId !== "") return;
    setBookingDirectionId(bookingDirections[0].id);
  }, [open, role, bookingDirections, bookingDirectionId]);

  function confirmTerminate(e: Employee) {
    setTerminateTarget(e);
  }

  const inviteMutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        full_name: fullName,
        email,
        phone,
        role,
        pipeline_ids: pipelineIds,
      };
      if (horecaRole) payload.horeca_role = horecaRole;
      if (role === "expert") {
        payload.specialization = expertSpecialization.trim();
        payload.booking_direction_id =
          typeof bookingDirectionId === "number" ? bookingDirectionId : undefined;
      }
      return apiFetch<InviteResult>("/api/employees/invite", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (r) => {
      setOpen(false);
      setFullName("");
      setEmail("");
      setPhone("");
      setRole("manager");
      setHorecaRole("");
      setPipelineIds([]);
      setExpertSpecialization("");
      setBookingDirectionId("");
      void qc.invalidateQueries({ queryKey: ["employees"] });
      void qc.invalidateQueries({ queryKey: ["booking-specialists"] });

      toast.success("Сотрудник приглашён");
      window.prompt("Приглашение отправлено сотруднику на email:", `Invite: ${r.invite_url}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function togglePipeline(id: number) {
    setPipelineIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function openEditPipelines(e: Employee) {
    setEditPipelinesEmployee(e);
    setEditPipelineIds([...e.pipeline_ids]);
  }

  function toggleEditPipeline(id: number) {
    setEditPipelineIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const patchPipelinesMutation = useMutation({
    mutationFn: () =>
      apiFetch<Employee>(`/api/employees/${editPipelinesEmployee!.id}/pipelines`, {
        method: "PATCH",
        body: JSON.stringify({ pipeline_ids: editPipelineIds }),
      }),
    onSuccess: () => {
      toast.success("Воронки сотрудника обновлены");
      setEditPipelinesEmployee(null);
      void qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function canEditPipelines(role: UserRole) {
    return role === "manager" || role === "admin" || role === "expert";
  }

  return (
    <div className="relative mx-auto max-w-[1200px] space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--mo-text)]">Сотрудники</h1>
          <p className="mt-1 text-sm lux-caption">
            Приглашение создаёт логин (email/телефон) и временный пароль.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={theme.btnPrimary}
        >
          Пригласить сотрудника
        </button>
      </header>

      {employeesQuery.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}
      {employeesQuery.isError && (
        <p className="text-sm text-red-300">{(employeesQuery.error as Error).message}</p>
      )}

      {(sourcesWithLeads.length > 0 || redistributionSourcesQuery.isLoading) &&
        activeSalesManagers.length >= 1 && (
        <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5 shadow-inner backdrop-blur-sm">
          <h2 className="lux-subheading">Перераспределение лидов</h2>
          <p className="mt-1 text-sm lux-caption">
            Все лиды выбранного менеджера равномерно передаются другим менеджерам (в том числе с уволенных
            аккаунтов). Входящие сообщения в чате и карточки клиентов откроются у новых ответственных.
          </p>

          {redistributionSourcesQuery.isLoading && (
            <p className="mt-2 text-sm mo-muted">Загрузка списка…</p>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm mo-muted">
              От кого забрать лиды
              <select
                value={redistributeFromId === "" ? "" : String(redistributeFromId)}
                onChange={(e) => {
                  const v = e.target.value;
                  setRedistributeFromId(v === "" ? "" : Number(v));
                  setRedistributeToIds([]);
                }}
                className="mo-input mt-1 w-full"
              >
                <option value="">— выберите менеджера —</option>
                {sourcesWithLeads.map((m) => (
                  <option key={m.manager_id} value={m.manager_id}>
                    {m.manager_name} — {m.lead_count} лид(ов)
                    {!m.is_active ? " · уволен" : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="text-sm mo-muted">
              <span className="mo-muted">Лидов у менеджера:</span>{" "}
              {redistributeFromId === "" ? (
                <span className="mo-muted">—</span>
              ) : redistributionPreviewQuery.isLoading ? (
                <span className="mo-muted">загрузка…</span>
              ) : redistributionPreviewQuery.isError ? (
                <span className="font-semibold text-amber-200">{selectedSource?.lead_count ?? 0}</span>
              ) : (
                <span className="font-semibold text-amber-200">
                  {redistributionPreviewQuery.data?.lead_count ?? selectedSource?.lead_count ?? 0}
                </span>
              )}
              {selectedSource && !selectedSource.is_active ? (
                <span className="mt-1 block text-xs text-amber-200/90">Аккаунт уволен — лиды всё ещё на нём</span>
              ) : null}
            </div>
          </div>

          {redistributeFromId !== "" && (
            <div className="mt-4 rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-3">
              <div className="lux-subheading text-sm">Кому передать</div>
              <p className="mt-1 text-[11px] mo-muted">
                Только активные менеджеры. Лиды делятся поровну (round-robin).
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {activeSalesManagers
                  .filter((m) => m.id !== redistributeFromId)
                  .map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm text-[var(--mo-text)]">
                      <input
                        type="checkbox"
                        checked={redistributeToIds.includes(m.id)}
                        onChange={() => toggleRedistributeTarget(m.id)}
                      />
                      <span className="truncate">
                        {m.full_name ?? m.email}
                        <span className="mo-muted"> · {m.role}</span>
                      </span>
                    </label>
                  ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={confirmRedistribute}
            disabled={
              redistributeMutation.isPending ||
              redistributeFromId === "" ||
              redistributeToIds.length === 0 ||
              (redistributionPreviewQuery.data?.lead_count ?? selectedSource?.lead_count ?? 0) <= 0
            }
            className="mt-4 rounded-xl border border-amber-500/40 bg-amber-600/20 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-600/30 disabled:opacity-50"
          >
            {redistributeMutation.isPending ? "Перераспределение…" : "Перераспределить лиды"}
          </button>
        </section>
      )}

      <div className="grid gap-3">
        {(employeesQuery.data ?? []).map((e) => (
          <div
            key={e.id}
            className="mo-section p-4 shadow-inner backdrop-blur-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate lux-subheading">
                  {e.full_name ?? "—"}
                </div>
                <div className="mt-1 text-sm lux-caption">
                  {e.email} {e.phone ? `· ${e.phone}` : ""} · роль: {e.role}
                  {e.horeca_role ? ` · HoReCa: ${HORECA_ROLE_LABEL[e.horeca_role] ?? e.horeca_role}` : ""}
                  {e.role === "expert" && e.specialization ? ` · ${e.specialization}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-xs lux-caption">
                  Воронки:{" "}
                  {e.pipeline_ids.length
                    ? e.pipeline_ids
                        .map((id) => pipelineById.get(id)?.name ?? `#${id}`)
                        .join(", ")
                    : "—"}
                </div>
                {canEditPipelines(e.role) ? (
                  <button
                    type="button"
                    onClick={() => openEditPipelines(e)}
                    className="shrink-0 rounded-lg border border-[var(--mo-border-strong)] bg-[var(--mo-surface-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--mo-text)] transition hover:bg-[var(--mo-accent-soft)]"
                  >
                    Воронки
                  </button>
                ) : null}
                {myUserId !== null && e.id !== myUserId && (
                  <button
                    type="button"
                    onClick={() => confirmTerminate(e)}
                    disabled={terminateTarget?.id === e.id}
                    className="shrink-0 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 transition hover:bg-red-500/20 disabled:opacity-50"
                  >
                    Уволить
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {!employeesQuery.isLoading && (employeesQuery.data ?? []).length === 0 && (
          <p className="text-sm mo-muted">Сотрудников пока нет.</p>
        )}
      </div>

      <section className="mo-section p-5 shadow-inner backdrop-blur-sm">
        <h2 className="lux-subheading">SMTP / Почта</h2>
        {smtpQuery.isLoading && <p className="mt-2 text-sm lux-caption">Загрузка SMTP…</p>}
        {smtpQuery.isError && (
          <p className="mt-2 text-sm text-red-300">{(smtpQuery.error as Error).message}</p>
        )}
        {smtpQuery.data && (
          <div className="mt-3 grid gap-2 text-sm mo-muted">
            <div>
              <span className="mo-muted">HOST:</span> {smtpQuery.data.host || "—"}
            </div>
            <div>
              <span className="mo-muted">PORT:</span> {smtpQuery.data.port}
            </div>
            <div>
              <span className="mo-muted">USER:</span> {smtpQuery.data.user || "—"}
            </div>
            <div>
              <span className="mo-muted">FROM:</span> {smtpQuery.data.from_email || "—"}
            </div>
            <div>
              <span className="mo-muted">PASSWORD:</span>{" "}
              {smtpQuery.data.has_password ? "задан" : "не задан"}
            </div>
            <div>
              <span className="mo-muted">PUBLIC_APP_URL:</span>{" "}
              {smtpQuery.data.public_app_url || "—"}
            </div>
            <div>
              <span className="mo-muted">PUBLIC_API_BASE_URL (WhatsApp):</span>{" "}
              {smtpQuery.data.public_api_base_url || "— (берётся из запроса, иначе задайте в .env)"}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={smtpTestEmail}
                onChange={(e) => setSmtpTestEmail(e.target.value)}
                placeholder="email для теста"
                className="min-w-[240px] flex-1 mo-input"
              />
              <button
                type="button"
                onClick={() => smtpTestMutation.mutate()}
                disabled={smtpTestMutation.isPending}
                className="rounded-xl border border-[var(--mo-border)] px-4 py-2 text-sm text-[var(--mo-text)] hover:bg-white disabled:opacity-60"
              >
                {smtpTestMutation.isPending ? "Отправка…" : "Тестовое письмо"}
              </button>
            </div>
          </div>
        )}
      </section>

      {terminateTarget && (
        <TerminateWithLeadsWizard
          employee={terminateTarget}
          activeManagers={activeSalesManagers}
          onClose={() => setTerminateTarget(null)}
          onDone={() => {
            setTerminateTarget(null);
            void qc.invalidateQueries({ queryKey: ["employees"] });
            void qc.invalidateQueries({ queryKey: ["booking-specialists"] });
          }}
        />
      )}

      {editPipelinesEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl crm-modal-panel border p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="lux-subheading">Воронки сотрудника</h2>
              <button
                type="button"
                onClick={() => setEditPipelinesEmployee(null)}
                className="rounded-full border border-[var(--mo-border)] px-3 py-1 text-sm mo-muted hover:bg-white"
              >
                Закрыть
              </button>
            </div>
            <p className="mt-2 text-sm mo-muted">
              {editPipelinesEmployee.full_name ?? editPipelinesEmployee.email} ·{" "}
              {editPipelinesEmployee.role === "manager"
                ? "менеджер"
                : editPipelinesEmployee.role === "admin"
                  ? "админ воронки"
                  : "эксперт"}
            </p>
            <div className="mt-4 rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-3">
              <p className="text-[11px] mo-muted">
                Отметьте воронки, в которых сотрудник видит лиды и записи. Нужна хотя бы одна воронка.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {pipelines.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm text-[var(--mo-text)]">
                    <input
                      type="checkbox"
                      checked={editPipelineIds.includes(p.id)}
                      onChange={() => toggleEditPipeline(p.id)}
                    />
                    <span className="truncate">{p.name}</span>
                  </label>
                ))}
                {pipelines.length === 0 && <div className="text-sm mo-muted">Нет воронок</div>}
              </div>
            </div>
            <button
              type="button"
              onClick={() => patchPipelinesMutation.mutate()}
              disabled={patchPipelinesMutation.isPending || editPipelineIds.length === 0}
              className={`mt-4 w-full ${theme.btnPrimary} disabled:opacity-60`}
            >
              {patchPipelinesMutation.isPending ? "Сохранение…" : "Сохранить воронки"}
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl crm-modal-panel border p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="lux-subheading">Пригласить сотрудника</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-[var(--mo-border)] px-3 py-1 text-sm mo-muted hover:bg-white"
              >
                Закрыть
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-sm mo-muted">
                ФИО
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
              <label className="text-sm mo-muted">
                Email
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
              <label className="text-sm mo-muted">
                Телефон
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>

              <label className="text-sm mo-muted">
                Роль
                <select
                  value={role}
                  onChange={(e) => {
                    const next = e.target.value as UserRole;
                    setRole(next);
                    if (next === "manager") setHorecaRole("waiter");
                    else if (next === "admin") setHorecaRole("hall_admin");
                    else if (next === "expert") setHorecaRole("cook");
                    else setHorecaRole("");
                    if (next !== "expert") {
                      setExpertSpecialization("");
                      setBookingDirectionId("");
                    } else if (bookingDirections.length > 0 && bookingDirectionId === "") {
                      setBookingDirectionId(bookingDirections[0].id);
                    }
                  }}
                  className="mo-input mt-1 w-full"
                >
                  <option value="owner">Владелец</option>
                  <option value="manager">Менеджер</option>
                  <option value="expert">Эксперт</option>
                  <option value="admin">Админ воронки</option>
                  <option value="finance_analyst">Финансовый аналитик</option>
                </select>
              </label>
              <label className="text-sm mo-muted">
                Роль в HoReCa
                <select
                  value={horecaRole}
                  onChange={(e) => setHorecaRole((e.target.value || "") as HorecaRole | "")}
                  className="mo-input mt-1 w-full"
                >
                  <option value="">— не назначать —</option>
                  <option value="waiter">Официант</option>
                  <option value="hall_admin">Администратор зала</option>
                  <option value="cook">Повар / кухня</option>
                  <option value="cashier">Кассир</option>
                </select>
              </label>

              {role === "expert" && (
                <>
                  <label className="text-sm mo-muted">
                    Специальность (под ФИО в календаре)
                    <input
                      value={expertSpecialization}
                      onChange={(e) => setExpertSpecialization(e.target.value)}
                      placeholder="Например: Невролог"
                      className="mo-input mt-1 w-full placeholder:mo-muted"
                    />
                  </label>
                  <label className="text-sm mo-muted">
                    Направление онлайн-записи
                    <select
                      value={bookingDirectionId === "" ? "" : String(bookingDirectionId)}
                      onChange={(e) => {
                        const v = e.target.value;
                        setBookingDirectionId(v === "" ? "" : Number(v));
                      }}
                      className="mo-input mt-1 w-full"
                    >
                      <option value="">— выберите —</option>
                      {bookingDirections.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {bookingDirectionsQuery.isLoading && (
                    <p className="text-xs mo-muted">Загрузка направлений…</p>
                  )}
                </>
              )}

              <div className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-3">
                <div className="lux-subheading text-sm">Направления (воронки)</div>
                <p className="mt-1 text-[11px] mo-muted">
                  Для менеджера, админа и эксперта нужна хотя бы одна воронка. После приглашения воронки можно изменить кнопкой
                  «Воронки» в карточке сотрудника.
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {pipelines.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm text-[var(--mo-text)]">
                      <input
                        type="checkbox"
                        checked={pipelineIds.includes(p.id)}
                        onChange={() => togglePipeline(p.id)}
                      />
                      <span className="truncate">{p.name}</span>
                    </label>
                  ))}
                  {pipelines.length === 0 && <div className="text-sm mo-muted">Нет воронок</div>}
                </div>
              </div>

              <button
                type="button"
                onClick={() => inviteMutation.mutate()}
                disabled={inviteMutation.isPending}
                className={`mt-2 w-full ${theme.btnPrimary} disabled:opacity-60`}
              >
                {inviteMutation.isPending ? "Добавление…" : "Добавить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

