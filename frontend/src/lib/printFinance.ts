/** Печать одного блока отчёта (P&L или ОСВ): классы на body + window.print(). */

export function printFinanceZone(mode: "pl" | "tb"): void {
  document.body.classList.remove("printing-pl", "printing-tb");
  document.body.classList.add(mode === "pl" ? "printing-pl" : "printing-tb");
  window.print();
  window.setTimeout(() => {
    document.body.classList.remove("printing-pl", "printing-tb");
  }, 800);
}
