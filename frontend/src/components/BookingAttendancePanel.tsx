import { Check, CheckCircle2 } from "@/components/icons";

type AttendanceStatus = "booked" | "completed" | "no_show";

type Props = {
  status: string;
  disabled?: boolean;
  onStatusChange: (status: AttendanceStatus) => void;
};

function XCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-4 w-4"}
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

export function BookingAttendancePanel({ status, disabled, onStatusChange }: Props) {
  if (status === "cancelled") return null;

  const isCompleted = status === "completed";
  const isNoShow = status === "no_show";

  return (
    <div className="booking-attendance-panel">
      <div className="booking-attendance-panel__actions" role="group" aria-label="Явка клиента">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={isCompleted}
          className={[
            "booking-attendance-choice",
            "booking-attendance-choice--arrived",
            isCompleted ? "is-active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onStatusChange("completed")}
        >
          <span className="booking-attendance-choice__icon" aria-hidden>
            {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          </span>
          <span className="booking-attendance-choice__text">Пришёл</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={isNoShow}
          className={[
            "booking-attendance-choice",
            "booking-attendance-choice--no-show",
            isNoShow ? "is-active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onStatusChange("no_show")}
        >
          <span className="booking-attendance-choice__icon" aria-hidden>
            <XCircleIcon />
          </span>
          <span className="booking-attendance-choice__text">Не явился</span>
        </button>
      </div>
      {(isCompleted || isNoShow) && (
        <button
          type="button"
          disabled={disabled}
          className="booking-attendance-reset"
          onClick={() => onStatusChange("booked")}
        >
          Сбросить
        </button>
      )}
    </div>
  );
}
