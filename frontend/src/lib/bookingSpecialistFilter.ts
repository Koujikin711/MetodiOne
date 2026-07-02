import type { BookingSpecialist } from "@/lib/types";

export const BOOKING_SPECIALIST_FILTER_STORAGE_KEY = "mo-booking-specialist-filter-v1";

export function specialistTypeLabel(s: BookingSpecialist): string {
  const name = (s.direction_name || s.specialization || "").trim();
  return name || "Без направления";
}

export function collectTypeLabels(specialists: BookingSpecialist[]): string[] {
  const set = new Set<string>();
  for (const s of specialists) set.add(specialistTypeLabel(s));
  return [...set].sort((a, b) => a.localeCompare(b, "ru"));
}

export type BookingSpecialistFilterPrefs = {
  typeNames: string[];
  specialistIds: number[];
};

export function allTypesSelected(typeNames: string[], selected: Set<string>): boolean {
  return typeNames.length > 0 && typeNames.every((t) => selected.has(t));
}

export function allSpecialistsSelected(specialists: BookingSpecialist[], selected: Set<number>): boolean {
  return specialists.length > 0 && specialists.every((s) => selected.has(s.id));
}

export function loadBookingSpecialistFilterPrefs(): BookingSpecialistFilterPrefs | null {
  try {
    const raw = localStorage.getItem(BOOKING_SPECIALIST_FILTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BookingSpecialistFilterPrefs;
    if (!Array.isArray(parsed.typeNames) || !Array.isArray(parsed.specialistIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveBookingSpecialistFilterPrefs(prefs: BookingSpecialistFilterPrefs): void {
  localStorage.setItem(BOOKING_SPECIALIST_FILTER_STORAGE_KEY, JSON.stringify(prefs));
}

export function clearBookingSpecialistFilterPrefs(): void {
  localStorage.removeItem(BOOKING_SPECIALIST_FILTER_STORAGE_KEY);
}

export function specialistsMatchingTypes(
  specialists: BookingSpecialist[],
  selectedTypeNames: Set<string>,
): BookingSpecialist[] {
  if (selectedTypeNames.size === 0) return [];
  return specialists.filter((s) => selectedTypeNames.has(specialistTypeLabel(s)));
}

export function filterCalendarSpecialists(
  specialists: BookingSpecialist[],
  selectedTypeNames: Set<string>,
  selectedSpecialistIds: Set<number>,
  appointmentSpecIds: Set<number>,
): BookingSpecialist[] {
  if (selectedTypeNames.size === 0 || selectedSpecialistIds.size === 0) {
    return specialists.filter((s) => appointmentSpecIds.has(s.id));
  }
  return specialists.filter((s) => {
    const typeOk = selectedTypeNames.has(specialistTypeLabel(s));
    const specOk = selectedSpecialistIds.has(s.id);
    return (typeOk && specOk) || appointmentSpecIds.has(s.id);
  });
}
