/** Черновики исходящих сообщений по thread_id (sessionStorage). */

const KEY = "metodi.chatDrafts";
const MAX_LEN = 8000;

type DraftMap = Record<string, string>;

function readAll(): DraftMap {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as DraftMap;
  } catch {
    return {};
  }
}

function writeAll(map: DraftMap) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* private mode / quota */
  }
}

export function readChatDraft(threadId: number): string {
  const v = readAll()[String(threadId)];
  return typeof v === "string" ? v : "";
}

export function writeChatDraft(threadId: number, text: string) {
  const map = readAll();
  const key = String(threadId);
  const trimmed = text.slice(0, MAX_LEN);
  if (!trimmed.trim()) {
    if (key in map) {
      delete map[key];
      writeAll(map);
    }
    return;
  }
  map[key] = trimmed;
  writeAll(map);
}

export function clearChatDraft(threadId: number) {
  const map = readAll();
  const key = String(threadId);
  if (!(key in map)) return;
  delete map[key];
  writeAll(map);
}
