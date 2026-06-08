import type { Lead } from "@/lib/types";

type PhoneLike = {
  phone?: string | null;
  phone_display?: string | null;
  phone_can_view_full?: boolean;
  patient_phone?: string;
  patient_phone_display?: string | null;
  patient_phone_can_view_full?: boolean;
};

export function displayPatientPhone(row: PhoneLike | Lead | null | undefined): string {
  if (!row) return "—";
  const display =
    ("phone_display" in row && row.phone_display) ||
    ("patient_phone_display" in row && row.patient_phone_display) ||
    row.phone ||
    ("patient_phone" in row ? row.patient_phone : null);
  return (display && String(display).trim()) || "—";
}

export function PatientPhone({
  value,
  className = "",
}: {
  value: PhoneLike | null | undefined;
  className?: string;
}) {
  const canView =
    ("phone_can_view_full" in (value || {}) && value?.phone_can_view_full) ||
    ("patient_phone_can_view_full" in (value || {}) && value?.patient_phone_can_view_full);
  const text = displayPatientPhone(value);
  return (
    <span className={className} title={canView ? undefined : "Номер скрыт политикой доступа"}>
      {text}
    </span>
  );
}
