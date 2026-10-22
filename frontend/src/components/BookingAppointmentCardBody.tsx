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
  compact?: boolean;
};

export function BookingAppointmentCardBody({
  appointment: a,
  timeLabel,
  canEditNotes,
  onNoteClick,
  compact,
}: Props) {
  const note = (a.comment || "").trim();
  const visitLabel = visitDisplayValue(a);
  const showVisitCounter =
    Boolean(visitLabel) && a.status !== "no_show" && a.status !== "cancelled";

  const noteTitle = note || "Добавить заметку";
  const noteControl = canEditNotes ? (
    <button
      type="button"
      className={[
        "booking-appt-note-btn shrink-0 rounded p-0.5 transition hover:bg-black/10",
        note ? "is-filled" : "is-empty",
      ].join(" ")}
      aria-label={noteTitle}
      onClick={(e) => {
        e.stopPropagation();
        onNoteClick?.(a);
      }}
    >
      <FileText className="h-3 w-3" />
    </button>
  ) : note ? (
    <span className="booking-appt-note-btn is-filled shrink-0 rounded p-0.5" aria-label={note}>
      <FileText className="h-3 w-3" />
    </span>
  ) : null;

  const noteWithTooltip = noteControl ? (
    <div className="booking-appt-note-wrap">
      {noteControl}
      <div role="tooltip" className="booking-appt-note-tooltip">
        {noteTitle}
      </div>
    </div>
  ) : null;

  const showFoot = Boolean(timeLabel || showVisitCounter);

  return (
    <div className="booking-appt-card-body relative">
      {!compact && noteWithTooltip ? (
        <div className="booking-appt-note-corner absolute right-0 top-0 z-[1]">{noteWithTooltip}</div>
      ) : null}
      <div className={["booking-appt-head min-h-0", !compact && noteWithTooltip ? "pr-4" : ""].filter(Boolean).join(" ")}>
        <span
          className={[
            "min-w-0 font-bold leading-tight",
            compact
              ? "block truncate text-[9px]"
              : "line-clamp-2 text-[10px] sm:text-[11px]",
          ].join(" ")}
        >
          {a.patient_name}
        </span>
      </div>
      {showFoot ? (
        <div
          className={[
            "booking-appt-foot mt-0.5 flex items-center justify-between gap-1",
            !compact && noteWithTooltip ? "pr-4" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
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
