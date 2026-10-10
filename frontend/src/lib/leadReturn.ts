const SPOT_KEY = "metodi.leadReturn";
const SECTION_KEY = "metodi.journalSection";

export type JournalSection = "course15" | "course";

export type LeadReturnSpot = {
  path: string;
  scroll: number;
  leadId: number;
  journalSection: JournalSection | null;
};

function isJournalSection(value: unknown): value is JournalSection {
  return value === "course15" || value === "course";
}

export function leadIdFromPath(pathname: string): number | null {
  const match = pathname.match(/^\/leads\/(\d+)\/?$/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function rememberJournalSection(section: JournalSection) {
  try {
    sessionStorage.setItem(SECTION_KEY, section);
  } catch {
    /* private mode */
  }
}

export function readJournalSection(): JournalSection {
  try {
    const raw = sessionStorage.getItem(SECTION_KEY);
    if (isJournalSection(raw)) return raw;
  } catch {
    /* private mode */
  }
  return "course15";
}

export function rememberLeadReturn(spot: LeadReturnSpot) {
  try {
    sessionStorage.setItem(SPOT_KEY, JSON.stringify(spot));
  } catch {
    /* private mode */
  }
}

export function readLeadReturn(): LeadReturnSpot | null {
  try {
    const raw = sessionStorage.getItem(SPOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LeadReturnSpot>;
    if (typeof parsed.path !== "string" || !parsed.path.startsWith("/")) return null;
    if (typeof parsed.leadId !== "number" || parsed.leadId <= 0) return null;
    return {
      path: parsed.path,
      scroll: typeof parsed.scroll === "number" && parsed.scroll > 0 ? parsed.scroll : 0,
      leadId: parsed.leadId,
      journalSection: isJournalSection(parsed.journalSection) ? parsed.journalSection : null,
    };
  } catch {
    return null;
  }
}

function scrollRowIntoMain(main: HTMLElement, row: HTMLElement) {
  const mainRect = main.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const next = main.scrollTop + (rowRect.top - mainRect.top) - main.clientHeight / 2 + rowRect.height / 2;
  main.scrollTo({ top: Math.max(0, next), left: 0, behavior: "auto" });
}

/** Вернуть прокрутку списка к строке карточки. Повторяет, пока таблица догружается. */
export function restoreLeadPlace(main: HTMLElement, spot: LeadReturnSpot) {
  const started = performance.now();

  const apply = () => {
    const row = main.querySelector<HTMLElement>(`[data-lead-row="${spot.leadId}"]`);
    if (row) {
      scrollRowIntoMain(main, row);
      return;
    }
    if (spot.scroll > 0) {
      main.scrollTo({ top: spot.scroll, left: 0, behavior: "auto" });
    }
    if (performance.now() - started < 2000) {
      requestAnimationFrame(apply);
    }
  };

  requestAnimationFrame(apply);
}
