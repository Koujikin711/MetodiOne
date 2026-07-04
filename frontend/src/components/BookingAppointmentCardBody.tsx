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

  const noteControl = canEditNotes ? (
    <button
      type="button"
      className={[
        "booking-appt-note-btn shrink-0 rounded p-0.5 transition hover:bg-black/10",
        note ? "is-filled" : "is-empty",
      ].join(" ")}
      aria-label={note ? "Редактировать заметку" : "Добавить заметку"}
      onClick={(e) => {
        e.stopPropagation();
        onNoteClick?.(a);
      }}
    >
      <FileText className="h-3 w-3" />
    </button>
  ) : note ? (
    <span className="booking-appt-note-btn is-filled shrink-0 rounded p-0.5" aria-hidden>
      <FileText className="h-3 w-3" />
    </span>
  ) : null;

  return (
    <div className="booking-appt-card-body">
      <div className="booking-appt-head flex min-h-0 items-start gap-0.5">
        <span className="line-clamp-2 min-w-0 flex-1 text-[10px] font-bold leading-tight sm:text-[11px]">
          {a.patient_name}
        </span>
        <div className="booking-appt-icons flex shrink-0 items-start gap-0.5">
          {noteControl ? (
            <div className="booking-appt-note-stack group/note relative flex flex-col items-center">
              {noteControl}
              {note ? (
                <div
                  role="tooltip"
                  className="booking-appt-note-tooltip pointer-events-none absolute bottom-full left-1/2 z-[90] mb-1 hidden w-max max-w-[min(220px,70vw)] -translate-x-1/2 rounded-md border border-[var(--mo-border-strong)] bg-[var(--mo-surface-elevated)] px-2 py-1 text-[10px] leading-snug text-[var(--mo-text)] shadow-lg group-hover/note:block group-focus-within/note:block"
                >
                  {note}
                </div>
              ) : (
                <div
                  role="tooltip"
                  className="booking-appt-note-tooltip pointer-events-none absolute bottom-full left-1/2 z-[90] mb-1 hidden w-max -translate-x-1/2 rounded-md border border-[var(--mo-border-strong)] bg-[var(--mo-surface-elevated)] px-2 py-1 text-[10px] mo-muted shadow-lg group-hover/note:block group-focus-within/note:block"
                >
                  Добавить заметку
                </div>
              )}
              {showVisitCounter ? (
                <span
                  className="booking-appt-visit mt-0.5 text-[9px] font-bold tabular-nums leading-none sm:text-[10px]"
                  title={visitDisplayTitle(a)}
                >
                  {visitLabel}
                </span>
              ) : null}
            </div>
          ) : showVisitCounter ? (
            <span
              className="booking-appt-visit text-[9px] font-bold tabular-nums leading-none sm:text-[10px]"
              title={visitDisplayTitle(a)}
            >
              {visitLabel}
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
      </div>
      {timeLabel ? (
        <div className="booking-appt-time-row mt-0.5">
          <span className="text-[9px] font-semibold tabular-nums leading-none opacity-90 sm:text-[10px]">{timeLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
