import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeUserIdFromToken } from "@/lib/auth";
import type { BookingDirection, Pipeline, UserRole } from "@/lib/types";

type HorecaRole = "waiter" | "hall_admin" | "cook" | "cashier";
const HORECA_ROLE_LABEL: Record<HorecaRole, string> = {
  waiter: "Официант",
  hall_admin: "Админ зала",
  cook: "Повар",
  cashier: "Кассир",
};

interface Employee {
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

  const pipelines = pipelinesQuery.data ?? [];
  const bookingDirections = bookingDirectionsQuery.data ?? [];
  const pipelineById = useMemo(() => new Map(pipelines.map((p) => [p.id, p])), [pipelines]);

  const myUserId = useMemo(() => decodeUserIdFromToken(getStoredToken()), []);

  useEffect(() => {
    if (!open || role !== "expert" || bookingDirections.length === 0 || bookingDirectionId !== "") return;
    setBookingDirectionId(bookingDirections[0].id);
  }, [open, role, bookingDirections, bookingDirectionId]);

  const terminateMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/employees/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["employees"] });
      void qc.invalidateQueries({ queryKey: ["booking-specialists"] });
      toast.success("Сотрудник уволен");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function confirmTerminate(e: Employee) {
    if (
      !window.confirm(
        `Уволить ${e.full_name ?? e.email}? Вход будет заблокирован, назначения по воронкам сняты.`,
      )
    ) {
      return;
    }
    terminateMutation.mutate(e.id);
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

  return (
    <div className="relative mx-auto max-w-[1200px] space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Сотрудники</h1>
          <p className="mt-1 text-sm text-slate-400">
            Приглашение создаёт логин (email/телефон) и временный пароль.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:opacity-95"
        >
          Пригласить сотрудника
        </button>
      </header>

      {employeesQuery.isLoading && <p className="text-sm text-slate-400">Загрузка…</p>}
      {employeesQuery.isError && (
        <p className="text-sm text-red-300">{(employeesQuery.error as Error).message}</p>
      )}

      <div className="grid gap-3">
        {(employeesQuery.data ?? []).map((e) => (
          <div
            key={e.id}
            className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4 shadow-inner backdrop-blur-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-white">
                  {e.full_name ?? "—"}
                </div>
                <div className="mt-1 text-sm text-slate-400">
                  {e.email} {e.phone ? `· ${e.phone}` : ""} · роль: {e.role}
                  {e.horeca_role ? ` · HoReCa: ${HORECA_ROLE_LABEL[e.horeca_role] ?? e.horeca_role}` : ""}
                  {e.role === "expert" && e.specialization ? ` · ${e.specialization}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-xs text-slate-400">
                  Направления:{" "}
                  {e.pipeline_ids.length
                    ? e.pipeline_ids
                        .map((id) => pipelineById.get(id)?.name ?? `#${id}`)
                        .join(", ")
                    : "—"}
                </div>
                {myUserId !== null && e.id !== myUserId && (
                  <button
                    type="button"
                    onClick={() => confirmTerminate(e)}
                    disabled={terminateMutation.isPending}
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
          <p className="text-sm text-slate-500">Сотрудников пока нет.</p>
        )}
      </div>

      <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5 shadow-inner backdrop-blur-sm">
        <h2 className="text-lg font-semibold text-white">SMTP / Почта</h2>
        {smtpQuery.isLoading && <p className="mt-2 text-sm text-slate-400">Загрузка SMTP…</p>}
        {smtpQuery.isError && (
          <p className="mt-2 text-sm text-red-300">{(smtpQuery.error as Error).message}</p>
        )}
        {smtpQuery.data && (
          <div className="mt-3 grid gap-2 text-sm text-slate-300">
            <div>
              <span className="text-slate-500">HOST:</span> {smtpQuery.data.host || "—"}
            </div>
            <div>
              <span className="text-slate-500">PORT:</span> {smtpQuery.data.port}
            </div>
            <div>
              <span className="text-slate-500">USER:</span> {smtpQuery.data.user || "—"}
            </div>
            <div>
              <span className="text-slate-500">FROM:</span> {smtpQuery.data.from_email || "—"}
            </div>
            <div>
              <span className="text-slate-500">PASSWORD:</span>{" "}
              {smtpQuery.data.has_password ? "задан" : "не задан"}
            </div>
            <div>
              <span className="text-slate-500">PUBLIC_APP_URL:</span>{" "}
              {smtpQuery.data.public_app_url || "—"}
            </div>
            <div>
              <span className="text-slate-500">PUBLIC_API_BASE_URL (WhatsApp):</span>{" "}
              {smtpQuery.data.public_api_base_url || "— (берётся из запроса, иначе задайте в .env)"}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={smtpTestEmail}
                onChange={(e) => setSmtpTestEmail(e.target.value)}
                placeholder="email для теста"
                className="min-w-[240px] flex-1 rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
              />
              <button
                type="button"
                onClick={() => smtpTestMutation.mutate()}
                disabled={smtpTestMutation.isPending}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800/40 disabled:opacity-60"
              >
                {smtpTestMutation.isPending ? "Отправка…" : "Тестовое письмо"}
              </button>
            </div>
          </div>
        )}
      </section>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Пригласить сотрудника</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800/40"
              >
                Закрыть
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-sm text-slate-300">
                ФИО
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                />
              </label>
              <label className="text-sm text-slate-300">
                Email
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                />
              </label>
              <label className="text-sm text-slate-300">
                Телефон
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                />
              </label>

              <label className="text-sm text-slate-300">
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
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                >
                  <option value="owner">Владелец</option>
                  <option value="manager">Менеджер</option>
                  <option value="expert">Эксперт</option>
                  <option value="admin">Админ воронки</option>
                  <option value="finance_analyst">Финансовый аналитик</option>
                </select>
              </label>
              <label className="text-sm text-slate-300">
                Роль в HoReCa
                <select
                  value={horecaRole}
                  onChange={(e) => setHorecaRole((e.target.value || "") as HorecaRole | "")}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
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
                  <label className="text-sm text-slate-300">
                    Специальность (под ФИО в календаре)
                    <input
                      value={expertSpecialization}
                      onChange={(e) => setExpertSpecialization(e.target.value)}
                      placeholder="Например: Невролог"
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white placeholder:text-slate-600"
                    />
                  </label>
                  <label className="text-sm text-slate-300">
                    Направление онлайн-записи
                    <select
                      value={bookingDirectionId === "" ? "" : String(bookingDirectionId)}
                      onChange={(e) => {
                        const v = e.target.value;
                        setBookingDirectionId(v === "" ? "" : Number(v));
                      }}
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
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
                    <p className="text-xs text-slate-500">Загрузка направлений…</p>
                  )}
                </>
              )}

              <div className="rounded-2xl border border-slate-700/50 bg-slate-950/30 p-3">
                <div className="text-sm font-semibold text-white">Направления (воронки)</div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Для владельца направления не обязательны. Для менеджера и админа воронки: направления CRM. Для админа воронки обязательна хотя бы одна
                  (журнал записей и лиды). Для эксперта — тоже хотя бы одна воронка CRM плюс специальность и направление
                  записи выше. Для финансового аналитика воронки не обязательны (доступ к отчётам и журналу без правок).
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {pipelines.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={pipelineIds.includes(p.id)}
                        onChange={() => togglePipeline(p.id)}
                      />
                      <span className="truncate">{p.name}</span>
                    </label>
                  ))}
                  {pipelines.length === 0 && <div className="text-sm text-slate-500">Нет воронок</div>}
                </div>
              </div>

              <button
                type="button"
                onClick={() => inviteMutation.mutate()}
                disabled={inviteMutation.isPending}
                className="mt-2 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:opacity-95 disabled:opacity-60"
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

