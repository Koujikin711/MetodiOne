import { CheckCircle2, CheckSquare, FileText } from "@/components/icons";
import { visitDisplayTitle, visitDisplayValue } from "@/lib/bookingVisitDisplay";
import type { BookingAppointment } from "@/lib/types";

type Props = {
  appointment: BookingAppointment;
  timeLabel: string | null;
  canEditNotes?: boolean;
  onNoteClick?: (a: BookingAppointment) => void;
  canToggleComplete?: boolean;
  onCompleteToggle?: (a: BookingAppointment, completed: boolean) => void;
};

export function BookingAppointmentCardBody({
  appointment: a,
  timeLabel,
  canEditNotes,
  onNoteClick,
  canToggleComplete,
  onCompleteToggle,
}: Props) {
  const note = (a.comment || "").trim();
  const isCompleted = a.status === "completed";
  const visitLabel = visitDisplayValue(a);
  const showVisitCounter =
    Boolean(visitLabel) && a.status !== "no_show" && a.status !== "cancelled";

  return (
    <>
      <div className="booking-appt-head flex min-h-0 items-center gap-0.5">
        <span className="line-clamp-1 min-w-0 flex-1 text-[10px] font-bold leading-tight sm:text-[11px]">
          {a.patient_name}
        </span>
        {canEditNotes ? (
          <button
            type="button"
            className={[
              "booking-appt-note-btn shrink-0 rounded p-0.5 transition hover:bg-black/10",
              note ? "is-filled" : "is-empty",
            ].join(" ")}
            title={note || "Добавить заметку"}
            aria-label={note ? "Редактировать заметку" : "Добавить заметку"}
            onClick={(e) => {
              e.stopPropagation();
              onNoteClick?.(a);
            }}
          >
            <FileText className="h-3 w-3" />
          </button>
        ) : note ? (
          <span className="booking-appt-note-btn is-filled shrink-0 rounded p-0.5" title={note} aria-hidden>
            <FileText className="h-3 w-3" />
          </span>
        ) : null}
        {canToggleComplete && a.status !== "cancelled" ? (
          <button
            type="button"
            className={[
              "booking-appt-attendance shrink-0 rounded p-0.5 transition hover:bg-black/10",
              isCompleted ? "is-done" : "is-pending",
            ].join(" ")}
            title={isCompleted ? "Снять отметку «явился»" : "Отметить явку (услуга оказана)"}
            aria-label={isCompleted ? "Снять отметку явки" : "Отметить явку"}
            onClick={(e) => {
              e.stopPropagation();
              onCompleteToggle?.(a, !isCompleted);
            }}
          >
            {isCompleted ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
          </button>
        ) : isCompleted ? (
          <span className="booking-appt-attendance is-done shrink-0 rounded p-0.5" aria-hidden>
            <CheckCircle2 className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>
      <div className="booking-appt-meta-row mt-0.5 flex items-end justify-between gap-0.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          {showVisitCounter ? (
            <span className="booking-appt-visit text-[9px] font-bold tabular-nums leading-none sm:text-[10px]" title={visitDisplayTitle(a)}>
              {visitLabel}
            </span>
          ) : null}
          {timeLabel ? (
            <span className="text-[9px] font-semibold tabular-nums leading-none opacity-90 sm:text-[10px]">{timeLabel}</span>
          ) : null}
        </div>
      </div>
    </>
  );
}
