import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken, decodeUserIdFromToken } from "@/lib/auth";
import { isReferralService } from "@/lib/referralService";

type ReferringDoctor = {
  user_id: number;
  full_name: string;
  title: string;
};

const CAN_SET = new Set(["expert", "administrator", "admin", "owner", "super_owner", "manager"]);
const CAN_CORRECT = new Set(["owner", "super_owner", "admin"]);

export function ReferringDoctorField({
  appointmentId,
  serviceTitle,
  directionName,
  referredByUserId,
  referredByName,
  onChange,
}: {
  appointmentId?: number;
  serviceTitle?: string | null;
  directionName?: string | null;
  referredByUserId?: number | null;
  referredByName?: string | null;
  onChange: (userId: number | null, fullName: string | null) => void;
}) {
  const token = getStoredToken();
  const role = decodeRoleFromToken(token);
  const userId = decodeUserIdFromToken(token);
  const queryClient = useQueryClient();
  const show = isReferralService(serviceTitle, directionName);
  const doctorsQuery = useQuery({
    queryKey: ["booking-referring-doctors"],
    queryFn: () => apiFetch<ReferringDoctor[]>("/api/booking/referring-doctors"),
    enabled: show,
    staleTime: 60_000,
  });

  if (!show) return null;

  const locked = referredByUserId != null && !CAN_CORRECT.has(role || "");
  const name =
    (referredByName || "").trim() ||
    (doctorsQuery.data ?? []).find((d) => d.user_id === referredByUserId)?.full_name ||
    "Врач";

  if (locked) {
    return (
      <p className="text-sm text-[var(--mo-text)]">
        <span className="mo-muted">Направил: </span>
        {name}
      </p>
    );
  }

  if (role && !CAN_SET.has(role) && referredByUserId == null) {
    return <p className="text-sm mo-muted">Направившего укажет врач или администратор</p>;
  }

  const options = (doctorsQuery.data ?? []).filter((d) => role !== "expert" || d.user_id === userId);

  async function pick(nextId: number) {
    const doctor = options.find((d) => d.user_id === nextId);
    onChange(nextId, doctor?.full_name ?? null);
    if (appointmentId == null) return;
    try {
      await apiFetch(`/api/booking/appointments/${appointmentId}/referrer`, {
        method: "PATCH",
        body: JSON.stringify({ referred_by_user_id: nextId }),
      });
      void queryClient.invalidateQueries({ queryKey: ["booking-appointments-grid"] });
      void queryClient.invalidateQueries({ queryKey: ["booking-appointments-by-lead"] });
      void queryClient.invalidateQueries({ queryKey: ["booking-journal"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить направившего");
    }
  }

  return (
    <label className="block text-sm mo-muted">
      Направил
      <select
        value={referredByUserId ?? ""}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (!Number.isFinite(next) || next <= 0) return;
          void pick(next);
        }}
        className="mt-1 w-full mo-input"
      >
        <option value="">— выберите врача —</option>
        {options.map((d) => (
          <option key={d.user_id} value={d.user_id}>
            {d.full_name}
            {d.title ? ` · ${d.title}` : ""}
          </option>
        ))}
      </select>
      {referredByUserId == null ? (
        <span className="mt-1 block text-[11px]">Без врача оплату этого направления не подтверждают</span>
      ) : null}
    </label>
  );
}
