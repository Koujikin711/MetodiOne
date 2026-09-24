import { useEffect, useMemo, useState } from "react";

import { FileText } from "@/components/icons";
import { formatTimeInBookingTz, ymdInBookingTz } from "@/lib/bookingTz";
import { visitDisplayTitle, visitDisplayValue } from "@/lib/bookingVisitDisplay";
import type { BookingAppointment, BookingSpecialist } from "@/lib/types";

type Props = {
  dateYmd: string;
  specialists: BookingSpecialist[];
  appointments: BookingAppointment[];
  onAppointmentClick: (a: BookingAppointment) => void;
  canEditNotes?: boolean;
  onAppointmentNoteClick?: (a: BookingAppointment) => void;
  showSessionInsteadOfTime?: boolean;
};

function statusClass(a: BookingAppointment): string {
  if (a.status === "cancelled") return "booking-day-list__row--cancelled";
  if (a.status === "no_show") return "booking-day-list__row--no_show";
  if (a.status === "completed") return "booking-day-list__row--completed";
  if (a.whatsapp_confirmation_sent) return "booking-day-list__row--notify";
  return "booking-day-list__row--booked";
}

export function BookingMobileDayList({
  dateYmd,
  specialists,
  appointments,
  onAppointmentClick,
  canEditNotes,
  onAppointmentNoteClick,
  showSessionInsteadOfTime,
}: Props) {
  const [specFilter, setSpecFilter] = useState<number | null>(null);

  useEffect(() => {
    if (specialists.length === 0) {
      setSpecFilter(null);
      return;
    }
    setSpecFilter((prev) => {
      if (prev != null && specialists.some((s) => s.id === prev)) return prev;
      return specialists[0]!.id;
    });
  }, [specialists]);

  const dayAppts = useMemo(() => {
    const list = appointments.filter((a) => {
      if (a.status === "cancelled") return false;
      if (ymdInBookingTz(new Date(a.start_at).getTime()) !== dateYmd) return false;
      if (specFilter != null && a.specialist_id !== specFilter) return false;
      return true;
    });
    list.sort(
      (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
    );
    return list;
  }, [appointments, dateYmd, specFilter]);

  return (
    <div className="booking-day-list">
      {specialists.length > 1 ? (
        <div className="booking-day-list__specs" role="tablist" aria-label="Эксперт">
          {specialists.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              data-active={specFilter === s.id ? "true" : "false"}
              className="booking-day-list__chip"
              onClick={() => setSpecFilter(s.id)}
            >
              {s.full_name.split(/\s+/)[0] || s.full_name}
            </button>
          ))}
        </div>
      ) : null}

      {dayAppts.length === 0 ? (
        <p className="booking-day-list__empty lux-caption">Нет записей на этот день</p>
      ) : (
        <ul className="booking-day-list__ul">
          {dayAppts.map((a) => {
            const visit = visitDisplayValue(a);
            const showVisit =
              Boolean(visit) && a.status !== "no_show" && a.status !== "cancelled";
            const note = (a.comment || "").trim();
            const timeLabel = showSessionInsteadOfTime
              ? null
              : formatTimeInBookingTz(a.start_at);
            const showNoteBtn = canEditNotes || Boolean(note);

            return (
              <li key={a.id} className={["booking-day-list__item", statusClass(a)].join(" ")}>
                <button
                  type="button"
                  className="booking-day-list__row"
                  onClick={() => onAppointmentClick(a)}
                >
                  <span className="booking-day-list__time tabular-nums">
                    {timeLabel ?? "—"}
                  </span>
                  <span className="booking-day-list__main">
                    <span className="booking-day-list__name">{a.patient_name}</span>
                  </span>
                  {showVisit ? (
                    <span className="booking-day-list__visit" title={visitDisplayTitle(a)}>
                      {visit}
                    </span>
                  ) : null}
                </button>
                {showNoteBtn ? (
                  <button
                    type="button"
                    className={[
                      "booking-day-list__note",
                      note ? "is-filled" : "is-empty",
                    ].join(" ")}
                    aria-label={note ? "Заметка" : "Добавить заметку"}
                    disabled={!canEditNotes}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canEditNotes) onAppointmentNoteClick?.(a);
                    }}
                  >
                    <FileText className="h-3 w-3" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
