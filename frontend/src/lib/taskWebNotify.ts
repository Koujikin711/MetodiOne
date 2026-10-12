import type { Task } from "@/lib/types";

const STATE_KEY = "crm_task_web_notify";

type NotifyState = {
  ready: boolean;
  known: string[];
  notified: string[];
};

function readState(): NotifyState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return { ready: false, known: [], notified: [] };
    const parsed = JSON.parse(raw) as Partial<NotifyState>;
    return {
      ready: Boolean(parsed.ready),
      known: Array.isArray(parsed.known) ? parsed.known.map(String) : [],
      notified: Array.isArray(parsed.notified) ? parsed.notified.map(String) : [],
    };
  } catch {
    return { ready: false, known: [], notified: [] };
  }
}

function writeState(state: NotifyState) {
  const next: NotifyState = {
    ready: state.ready,
    known: state.known.slice(-300),
    notified: state.notified.slice(-300),
  };
  localStorage.setItem(STATE_KEY, JSON.stringify(next));
}

export function taskNotifyPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export async function enableTaskNotifications(): Promise<NotificationPermission | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.requestPermission();
}

function showNotification(title: string, body: string, tag: string): boolean {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  const note = new Notification(title, { body, tag });
  note.onclick = () => {
    window.focus();
    window.location.assign("/tasks");
  };
  return true;
}

function warnTitle(stage: Task["warn_stage"]) {
  if (stage === "30") return "Через 30 минут задача";
  if (stage === "15") return "Через 15 минут задача";
  return "Пора выполнить задачу";
}

function taskBody(task: Task) {
  const time = task.deadline
    ? new Date(task.deadline).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : "";
  const daily = task.repeats_daily ? " · каждый день" : "";
  const client = [task.client_name, task.client_phone].filter(Boolean).join(" · ");
  return `${task.title}${client ? ` · ${client}` : ""}${time ? ` · ${time}` : ""}${daily}`;
}

/** Первая загрузка запоминает уже лежащие задачи. Новые, за 30 и 15 минут и в час — уведомление. */
export function syncTaskWebNotifications(active: Task[], due: Task[]): Task[] {
  const state = readState();
  const fresh: Task[] = [];

  for (const task of due) {
    const stage = task.warn_stage ?? "due";
    const key = `due:${task.id}:${task.deadline ?? ""}:${stage}`;
    if (state.notified.includes(key)) continue;
    if (showNotification(warnTitle(stage), taskBody(task), key)) state.notified.push(key);
  }

  if (!state.ready) {
    state.known = active.map((task) => String(task.id));
    state.ready = true;
    writeState(state);
    return fresh;
  }

  const known = new Set(state.known);
  for (const task of active) {
    const key = String(task.id);
    if (known.has(key)) continue;
    fresh.push(task);
    const notifyKey = `new:${key}`;
    if (!state.notified.includes(notifyKey) && showNotification("Новая задача", taskBody(task), notifyKey)) {
      state.notified.push(notifyKey);
    }
    state.known.push(key);
  }
  writeState(state);
  return fresh;
}
