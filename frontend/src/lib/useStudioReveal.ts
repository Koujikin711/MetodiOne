import { useEffect } from "react";

/** Observe [data-reveal] nodes and mark .is-visible when they enter the viewport. */
export function useStudioReveal(deps: unknown[] = []) {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!nodes.length) return;

    if (typeof IntersectionObserver === "undefined") {
      nodes.forEach((n) => n.classList.add("is-visible"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
    );

    nodes.forEach((n) => {
      if (!n.classList.contains("is-visible")) io.observe(n);
    });

    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls refresh deps
  }, deps);
}
