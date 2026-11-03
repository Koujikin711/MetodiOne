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

/** Куда вести «Назад» с карточки лида. */
export function leadBackHref(fallback = "/crm"): { to: string; label: string } {
  const spot = readLeadReturn();
  if (!spot) return { to: fallback, label: "Назад" };
  const pathOnly = spot.path.split("?")[0] || spot.path;
  let label = "Назад";
  if (pathOnly.startsWith("/booking")) label = "Онлайн запись";
  else if (pathOnly.startsWith("/crm") || pathOnly === "/") label = "CRM";
  else if (pathOnly.startsWith("/chat")) label = "Чаты";
  else if (pathOnly.startsWith("/my-leads")) label = "Мои лиды";
  else if (pathOnly.startsWith("/kpi") || pathOnly.startsWith("/sales")) label = "KPI";
  else if (pathOnly.includes("curator") || pathOnly.includes("journal")) label = "Журнал";
  return { to: spot.path, label };
}

export function sameReturnPlace(spotPath: string, currentFull: string): boolean {
  const spotOnly = spotPath.split("?")[0] || spotPath;
  const curOnly = currentFull.split("?")[0] || currentFull;
  return spotOnly === curOnly;
}

function scrollableAncestor(from: HTMLElement, stop: HTMLElement): HTMLElement {
  let el: HTMLElement | null = from;
  while (el && el !== stop) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll" || oy === "overlay") && el.scrollHeight > el.clientHeight + 1) {
      return el;
    }
    el = el.parentElement;
  }
  return stop;
}

function scrollRowIntoView(main: HTMLElement, row: HTMLElement) {
  const scroller = scrollableAncestor(row, main);
  const scrollerRect = scroller.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const next =
    scroller.scrollTop + (rowRect.top - scrollerRect.top) - scroller.clientHeight / 2 + rowRect.height / 2;
  scroller.scrollTo({ top: Math.max(0, next), left: 0, behavior: "auto" });
  if (scroller !== main && main.scrollHeight > main.clientHeight + 1) {
    const mainRect = main.getBoundingClientRect();
    const rowRect2 = row.getBoundingClientRect();
    const mainNext =
      main.scrollTop + (rowRect2.top - mainRect.top) - main.clientHeight / 2 + rowRect2.height / 2;
    main.scrollTo({ top: Math.max(0, mainNext), left: 0, behavior: "auto" });
  }
}

/** Вернуть прокрутку списка к строке карточки. Повторяет, пока таблица догружается. */
export function restoreLeadPlace(main: HTMLElement, spot: LeadReturnSpot) {
  const started = performance.now();

  const apply = () => {
    const row = main.querySelector<HTMLElement>(`[data-lead-row="${spot.leadId}"]`);
    if (row) {
      scrollRowIntoView(main, row);
      return;
    }
    if (spot.scroll > 0) {
      main.scrollTo({ top: spot.scroll, left: 0, behavior: "auto" });
    }
    if (performance.now() - started < 2500) {
      requestAnimationFrame(apply);
    }
  };

  requestAnimationFrame(apply);
}

type NavigateFn = (to: string, opts?: { replace?: boolean }) => void;

/** Открыть карточку лида, запомнив откуда и скролл (кнопки navigate, не только <a>). */
export function openLeadCard(
  navigate: NavigateFn,
  leadId: number,
  opts?: { search?: string; main?: HTMLElement | null },
) {
  const path = `${window.location.pathname}${window.location.search}`;
  rememberLeadReturn({
    path,
    scroll: opts?.main?.scrollTop ?? document.querySelector<HTMLElement>("main.shell-main")?.scrollTop ?? 0,
    leadId,
    journalSection: readJournalSection(),
  });
  const q = (opts?.search || "").replace(/^\?/, "");
  navigate(q ? `/leads/${leadId}?${q}` : `/leads/${leadId}`);
}
