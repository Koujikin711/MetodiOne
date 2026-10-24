import { useMemo, useState } from "react";

import { formatMoney } from "@/lib/money";

type Mode = "subtract" | "set";

export function OwnerPaidAdjust({
  paid,
  serviceAmount,
  pending,
  onApply,
}: {
  paid: number;
  serviceAmount: number;
  pending: boolean;
  onApply: (body: { mode: Mode; amount: number; reason: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("subtract");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const parsed = Number(String(amount).replace(",", "."));
  const validAmount = Number.isFinite(parsed) && (mode === "set" ? parsed >= 0 : parsed > 0);
  const nextPaid = useMemo(() => {
    if (!validAmount) return null;
    return mode === "subtract" ? paid - parsed : parsed;
  }, [mode, paid, parsed, validAmount]);
  const nextDebt = nextPaid == null ? null : Math.max(serviceAmount - nextPaid, 0);
  const tooMuch =
    nextPaid != null && (nextPaid < 0 || (serviceAmount > 0 && nextPaid > serviceAmount + 0.001));
  const reasonOk = reason.trim().length >= 3;

  return (
    <div className="owner-paid-adjust print-omit mt-1">
      <button
        type="button"
        className="text-[11px] font-medium text-[var(--mo-text)] underline-offset-2 hover:underline"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Скрыть правку" : "Исправить сумму"}
      </button>
      {!open ? null : (
        <>
      <p className="mt-1 text-[11px] font-semibold text-[var(--mo-text)]">Правка владельца</p>
      <p className="text-[11px] mo-muted">
        Сейчас оплачено {formatMoney(paid)} из {formatMoney(serviceAmount)}. Снятие забирает с последней оплаты.
        Запись попадёт в аудит.
      </p>
      <div className="mt-1.5 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] mo-muted">
          Что сделать
          <select
            className="mo-input !min-h-9 text-sm"
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            aria-label="Способ правки оплаты"
          >
            <option value="subtract">Снять</option>
            <option value="set">Поставить сумму</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] mo-muted">
          Сумма
          <input
            type="number"
            min={0}
            inputMode="decimal"
            className="mo-input w-28 !min-h-9 text-sm"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={mode === "subtract" ? "Сколько снять" : "Новая оплата"}
          />
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[11px] mo-muted">
          Причина
          <input
            className="mo-input !min-h-9 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Зачем меняется сумма"
            aria-label="Причина правки оплаты"
          />
        </label>
        <button
          type="button"
          className="btn-secondary min-h-9 px-3 text-sm disabled:opacity-50"
          disabled={pending || !validAmount || !reasonOk || tooMuch}
          onClick={() => {
            if (!validAmount || !reasonOk || tooMuch) return;
            onApply({ mode, amount: parsed, reason: reason.trim() });
            setAmount("");
            setReason("");
          }}
        >
          {mode === "subtract" ? "Снять" : "Поставить"}
        </button>
      </div>
      {nextPaid != null ? (
        <p className={`mt-1 text-[11px] ${tooMuch ? "text-red-300" : "mo-muted"}`}>
          {tooMuch
            ? nextPaid < 0
              ? "Снять можно не больше того, что уже оплачено."
              : "Оплата не может быть больше стоимости."
            : `Станет оплачено ${formatMoney(nextPaid)}, долг ${formatMoney(nextDebt ?? 0)}.`}
        </p>
      ) : null}
        </>
      )}
    </div>
  );
}
