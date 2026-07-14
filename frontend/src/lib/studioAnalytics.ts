type StudioProps = Record<string, string | number | boolean | undefined | null>;

const QUEUE_KEY = "mo-studio-events";

function pushLocal(name: string, props?: StudioProps) {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    list.push({ name, props: props ?? {}, ts: new Date().toISOString() });
    while (list.length > 80) list.shift();
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/** Fire-and-forget studio funnel events (landing / demos / investors). */
export function trackStudioEvent(name: string, props?: StudioProps) {
  pushLocal(name, props);

  const payload = JSON.stringify({
    name,
    props: props ?? {},
    path: typeof window !== "undefined" ? window.location.pathname : "",
    lang: typeof document !== "undefined" ? document.documentElement.lang : "",
  });

  try {
    const url = "/api/system/studio-event";
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    });
  } catch {
    /* network optional */
  }

  try {
    window.dispatchEvent(new CustomEvent("mo-studio-event", { detail: { name, props } }));
  } catch {
    /* ignore */
  }
}
