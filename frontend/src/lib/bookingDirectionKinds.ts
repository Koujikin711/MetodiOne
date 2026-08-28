/** Matches backend `booking_directions.is_*` helpers for course / consult UX. */

function normalizeName(name: string | null | undefined): string {
  return (name || "")
    .trim()
    .replace(/\s*\[архив #\d+\]\s*$/i, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ru");
}

/** Курс / Курс 15 / Протокол — пакетные услуги (free-consult, ремап). */
export function isCourseLikeDirectionName(name: string | null | undefined): boolean {
  const k = normalizeName(name);
  if (!k) return false;
  if (k === "курс" || k === "курс 15" || k === "курс 90" || k === "протокол" || k === "пртокол") {
    return true;
  }
  if (k.startsWith("курс ") || k.startsWith("протокол")) return true;
  if (k.includes("курс") && (k.includes("15") || k.includes("90") || k.includes("руз") || k.includes("калон"))) {
    return true;
  }
  if (k.includes("протокол") || k.includes("пртокол")) return true;
  return false;
}

/** Только админ в онлайн-записи: «Курс» и «Протокол». «Курс 15» — менеджер может. */
export function isAdminOnlyBookingDirectionName(name: string | null | undefined): boolean {
  const k = normalizeName(name);
  if (!k) return false;
  if (k === "курс" || k === "протокол" || k === "пртокол") return true;
  if (k.startsWith("протокол") || k.startsWith("пртокол")) return true;
  if (k === "курс 90" || (k.startsWith("курс ") && k.includes("90") && !k.includes("15"))) return true;
  return false;
}

export function isConsultationDirectionName(name: string | null | undefined): boolean {
  const k = normalizeName(name);
  return k.includes("консульт") || k.includes("консулт") || k.startsWith("консульт");
}

export function isGanchinaSpecialistName(name: string | null | undefined): boolean {
  const k = normalizeName(name);
  return k.includes("ганчин") || (k.includes("замири") && k.includes("ганч"));
}

export function canBookCourseLike(role: string | null | undefined): boolean {
  return role === "owner" || role === "super_owner" || role === "admin";
}
