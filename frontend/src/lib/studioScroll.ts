/** Sticky studio header offset for in-page anchors. */
export const STUDIO_HEADER_OFFSET_PX = 84;

export function scrollToStudioId(id: string, behavior: ScrollBehavior = "smooth") {
  const el = document.getElementById(id);
  if (!el) return false;
  const top = el.getBoundingClientRect().top + window.scrollY - STUDIO_HEADER_OFFSET_PX;
  window.scrollTo({ top: Math.max(0, top), behavior });
  return true;
}

export function studioHashId(hash: string): string | null {
  if (!hash || hash === "#") return null;
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  return id || null;
}
