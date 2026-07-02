type AttendanceStatus = "booked" | "completed" | "no_show";

type Props = {
  status: string;
  disabled?: boolean;
  onStatusChange: (status: AttendanceStatus) => void;
};

export function BookingAttendancePanel({ status, disabled, onStatusChange }: Props) {
  if (status === "cancelled") return null;

  return (
    <div className="booking-attendance-box">
      <p className="text-xs font-semibold uppercase tracking-wide mo-muted">Явка клиента</p>
      <p className="mt-1 text-xs mo-muted">Отметьте, пришёл ли клиент на приём</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          className={["booking-attendance-btn", status === "completed" ? "is-arrived" : "is-idle"].join(" ")}
          onClick={() => onStatusChange("completed")}
        >
          ✓ Клиент пришёл
        </button>
        <button
          type="button"
          disabled={disabled}
          className={["booking-attendance-btn", status === "no_show" ? "is-no-show" : "is-idle"].join(" ")}
          onClick={() => onStatusChange("no_show")}
        >
          ✗ Не явился
        </button>
        {(status === "completed" || status === "no_show") && (
          <button
            type="button"
            disabled={disabled}
            className="booking-attendance-btn is-idle"
            onClick={() => onStatusChange("booked")}
          >
            Сбросить
          </button>
        )}
      </div>
    </div>
  );
}
