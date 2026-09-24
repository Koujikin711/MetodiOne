import { FileText } from "@/components/icons";
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
}: Props) {
  const note = (a.comment || "").trim();
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

  const noteWithTooltip = noteControl ? (
    <div className="group/note relative shrink-0">
      {noteControl}
      {note ? (
        <div
          role="tooltip"
          className="booking-appt-note-tooltip pointer-events-none absolute bottom-full right-0 z-[90] mb-1 hidden w-max max-w-[min(220px,70vw)] rounded-md border border-[var(--mo-border-strong)] bg-[var(--mo-surface-elevated)] px-2 py-1 text-[10px] leading-snug text-[var(--mo-text)] shadow-lg group-hover/note:block group-focus-within/note:block"
        >
          {note}
        </div>
      ) : (
        <div
          role="tooltip"
          className="booking-appt-note-tooltip pointer-events-none absolute bottom-full right-0 z-[90] mb-1 hidden w-max rounded-md border border-[var(--mo-border-strong)] bg-[var(--mo-surface-elevated)] px-2 py-1 text-[10px] mo-muted shadow-lg group-hover/note:block group-focus-within/note:block"
        >
          Добавить заметку
        </div>
      )}
    </div>
  ) : null;

  const showFoot = Boolean(timeLabel || showVisitCounter);

  return (
    <div className="booking-appt-card-body relative">
      {noteWithTooltip ? (
        <div className="booking-appt-note-corner absolute right-0 top-0 z-[1]">{noteWithTooltip}</div>
      ) : null}
      <div className={["booking-appt-head min-h-0", noteWithTooltip ? "pr-4" : ""].filter(Boolean).join(" ")}>
        <span className="line-clamp-2 min-w-0 text-[10px] font-bold leading-tight sm:text-[11px]">
          {a.patient_name}
        </span>
      </div>
      {showFoot ? (
        <div className="booking-appt-foot mt-0.5 flex items-center justify-between gap-1">
          {timeLabel ? (
            <span className="text-[9px] font-semibold tabular-nums leading-none opacity-90 sm:text-[10px]">
              {timeLabel}
            </span>
          ) : (
            <span />
          )}
          {showVisitCounter ? (
            <span
              className="booking-appt-visit shrink-0 text-[9px] font-bold tabular-nums leading-none sm:text-[10px]"
              title={visitDisplayTitle(a)}
            >
              {visitLabel}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
