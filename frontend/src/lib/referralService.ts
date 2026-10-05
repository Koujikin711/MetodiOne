/** Остеопатия, ТМС, анализы, массаж. Логомассаж и курс не входят. */

function lineOf(name: string | null | undefined): string {
  const k = (name || "").toLowerCase().replace(/ё/g, "е");
  if (!k.trim()) return "other";
  if (k.includes("логомассаж") || k.includes("логопед")) return "speech_massage";
  if (k.includes("остеоп") || k.includes("остиоп")) return "osteopath";
  if (k.includes("тмс") || k.includes("tms")) return "tms";
  if (k.includes("анализ") || k.includes("лаборат")) return "lab";
  if (k.includes("массаж")) return "massage";
  return "other";
}

const REFERRAL = new Set(["osteopath", "tms", "lab", "massage"]);

export function isReferralService(
  serviceTitle: string | null | undefined,
  directionName: string | null | undefined,
): boolean {
  const lines = [lineOf(serviceTitle), lineOf(directionName)];
  if (lines.includes("speech_massage")) return false;
  return lines.some((line) => REFERRAL.has(line));
}
