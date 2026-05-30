import { Link } from "react-router-dom";

/** Подсказка по демо-режиму и самообслуживанию тарифа (платформа). */
export function FinanceDemoHint() {
  return (
    <div className="mo-section border-[#2f5f85]/25 bg-[#e8f0f7]/60 text-sm text-[#1e3348]">
      <p className="font-semibold">Демо и тариф</p>
      <p className="mt-1 text-[#5c6b7a]">
        Песочница: добавьте{" "}
        <code className="rounded bg-white/80 px-1 text-[#2f5f85]">?demo=1</code> к адресу после входа. Тариф и оплата — в{" "}
        <Link to="/billing" className="mo-link font-medium">
          разделе «Оплата и тариф»
        </Link>
        .
      </p>
    </div>
  );
}
