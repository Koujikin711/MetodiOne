import { useState } from "react";
import { Check, CheckCircle2 } from "@/components/icons";
import { formatMoney } from "@/lib/money";

type AttendanceStatus = "booked" | "completed" | "no_show";
type PaymentMethod = "cash" | "alif" | "dc";

const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Наличные" },
  { value: "alif", label: "Алиф" },
  { value: "dc", label: "DC" },
];

type Props = {
  status: string;
  disabled?: boolean;
  serviceAmount?: number;
  paidAmount?: number;
  onStatusChange: (
    status: AttendanceStatus,
    addPayment?: number,
    paymentMethod?: PaymentMethod,
  ) => void;
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

function debtOf(serviceAmount?: number, paidAmount?: number): number {
  const service = Number(serviceAmount ?? 0);
  const paid = Number(paidAmount ?? 0);
  if (!(service > 0)) return 0;
  return Math.max(0, Math.round((service - paid) * 100) / 100);
}

export function BookingAttendancePanel({
  status,
  disabled,
  serviceAmount,
  paidAmount,
  onStatusChange,
}: Props) {
  if (status === "cancelled") return null;

  const isCompleted = status === "completed";
  const isNoShow = status === "no_show";
  const debt = debtOf(serviceAmount, paidAmount);
  const [remainderOpen, setRemainderOpen] = useState(false);
  const [remainder, setRemainder] = useState(String(debt || ""));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");

  function requestArrived() {
    if (debt > 0.009) {
      setRemainder(String(debt));
      setPaymentMethod("");
      setRemainderOpen(true);
      return;
    }
    onStatusChange("completed");
  }

  function confirmArrivedWithRemainder() {
    const raw = remainder.replace(",", ".").trim();
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      return;
    }
    if (value + 1e-9 < debt) {
      return;
    }
    if (value > 1e-9 && !paymentMethod) {
      return;
    }
    onStatusChange("completed", value, paymentMethod || undefined);
    setRemainderOpen(false);
  }

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
          onClick={requestArrived}
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
          onClick={() => {
            setRemainderOpen(false);
            onStatusChange("no_show");
          }}
        >
          <span className="booking-attendance-choice__icon" aria-hidden>
            <XCircleIcon />
          </span>
          <span className="booking-attendance-choice__text">Не явился</span>
        </button>
      </div>

      {remainderOpen ? (
        <div className="booking-attendance-remainder">
          <p className="booking-attendance-remainder__title">Остаток к оплате при явке</p>
          <p className="booking-attendance-remainder__hint">
            Стоимость {formatMoney(Number(serviceAmount ?? 0))}, уже оплачено{" "}
            {formatMoney(Number(paidAmount ?? 0))}, долг {formatMoney(debt)}
          </p>
          <label className="booking-attendance-remainder__label">
            Сумма остатка
            <input
              type="number"
              min={debt}
              step="1"
              inputMode="decimal"
              className="mo-input mt-1 w-full py-1.5"
              value={remainder}
              disabled={disabled}
              onChange={(e) => setRemainder(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmArrivedWithRemainder();
                }
              }}
            />
          </label>
          {Number(remainder.replace(",", ".") || 0) > 0 ? (
            <fieldset className="mt-2">
              <legend className="mb-1.5 text-xs mo-muted">Способ оплаты</legend>
              <div className="flex flex-wrap gap-1.5">
                {PAYMENT_METHOD_OPTIONS.map((opt) => {
                  const active = paymentMethod === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={disabled}
                      onClick={() => setPaymentMethod(opt.value)}
                      className={[
                        "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                        active
                          ? "border-[var(--mo-accent)] bg-[var(--mo-accent)]/15 text-[var(--mo-text)]"
                          : "border-[var(--mo-border)] bg-[var(--mo-surface)] text-[var(--mo-text-muted)] hover:border-[var(--mo-accent)]/50",
                      ].join(" ")}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}
          <div className="booking-attendance-remainder__actions">
            <button
              type="button"
              className="btn-secondary px-2.5 py-1.5 text-xs"
              disabled={disabled}
              onClick={() => setRemainderOpen(false)}
            >
              Отмена
            </button>
            <button
              type="button"
              className="btn-primary px-2.5 py-1.5 text-xs"
              disabled={
                disabled ||
                !Number.isFinite(Number(remainder.replace(",", "."))) ||
                Number(remainder.replace(",", ".")) + 1e-9 < debt ||
                (Number(remainder.replace(",", ".")) > 1e-9 && !paymentMethod)
              }
              onClick={confirmArrivedWithRemainder}
            >
              Пришёл и оплатил
            </button>
          </div>
        </div>
      ) : null}

      {(isCompleted || isNoShow) && !remainderOpen ? (
        <button
          type="button"
          disabled={disabled}
          className="booking-attendance-reset"
          onClick={() => onStatusChange("booked")}
        >
          Сбросить
        </button>
      ) : null}
    </div>
  );
}
