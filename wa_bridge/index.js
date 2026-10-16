/**
 * WhatsApp sidecar (Baileys QR).
 * Adapted from qatrai-hayot/wa_bridge/index.js (itself from bot-whatsapp).
 * Own Node process on 127.0.0.1 — do not import this file from the API.
 */
console.log("=== MetodiOne WA BRIDGE: Baileys (separate process) ===");

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const pino = require("pino");

const makeWASocket = require("@whiskeysockets/baileys").default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  Browsers,
} = require("@whiskeysockets/baileys");

const DATA_ROOT = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const WEBHOOK_URL =
  process.env.WEBHOOK_URL || "http://127.0.0.1:8000/api/integrations/wa-bridge/incoming";
const WA_PORT = parseInt(process.env.WA_BRIDGE_PORT || "8766", 10);
const BRIDGE_TOKEN = process.env.WA_BRIDGE_TOKEN || "";

const INCOMING_DIR = path.join(DATA_ROOT, "wa-incoming");
const SESSION_DIR = path.join(DATA_ROOT, "wa_session_baileys");
const STATE_FILE = path.join(DATA_ROOT, "wa_bridge_state.json");
const VERSION_CACHE = path.join(DATA_ROOT, "baileys_wa_version.json");
fs.mkdirSync(INCOMING_DIR, { recursive: true });
fs.mkdirSync(SESSION_DIR, { recursive: true });

const logger = pino({ level: process.env.BAILEYS_LOG || "warn" });
const MEDIA_MAX = 20 * 1024 * 1024;
const RECENT_WINDOW_SEC = 30 * 60;
// Asia/Dushanbe is UTC+5 with no DST: younger than 5 days is now−5×24h.
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const HISTORY_FULL = 2;

let sock = null;
let waState = {
  ready: false,
  phone: null,
  name: null,
  error: null,
  qrDataUrl: null,
  connectionState: "INIT",
};
let starting = false;
let skipAutoReconnect = false;
let reconnectTimer = null;
let reconnectAttempt = 0;
let badSessionStrikes = 0;
let cachedWaVersion = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publishState() {
  const body = JSON.stringify({
    ready: waState.ready,
    phone: waState.phone,
    name: waState.name,
    connectionState: waState.connectionState,
    error: waState.error ? String(waState.error).slice(0, 180) : null,
    updatedAt: new Date().toISOString(),
  });
  try {
    fs.writeFileSync(STATE_FILE, body);
  } catch (e) {
    console.warn("state file:", e.message);
  }
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function backoffMs(baseMs) {
  const exp = Math.min(reconnectAttempt, 6);
  const ms = Math.min(baseMs * Math.pow(2, exp), 120000);
  reconnectAttempt += 1;
  return ms;
}

function scheduleReconnect(baseMs, reason) {
  if (skipAutoReconnect) return;
  clearReconnectTimer();
  const ms = backoffMs(baseMs);
  console.log(`Reconnect in ${ms}ms (${reason}, attempt=${reconnectAttempt})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startSock().catch((e) => {
      waState.error = e.message;
      publishState();
    });
  }, ms);
}

async function resolveWaVersion() {
  if (cachedWaVersion) return cachedWaVersion;
  try {
    if (fs.existsSync(VERSION_CACHE)) {
      const raw = JSON.parse(fs.readFileSync(VERSION_CACHE, "utf8"));
      if (Array.isArray(raw?.version) && raw.version.length === 3) {
        const ageH = (Date.now() - (raw.savedAt || 0)) / 3600000;
        if (ageH < 72) {
          cachedWaVersion = raw.version;
          console.log("WA version from cache:", cachedWaVersion.join("."));
          return cachedWaVersion;
        }
      }
    }
  } catch (e) {
    console.warn("version cache read:", e.message);
  }
  try {
    const { version } = await fetchLatestBaileysVersion();
    cachedWaVersion = version;
    try {
      fs.writeFileSync(
        VERSION_CACHE,
        JSON.stringify({ version, savedAt: Date.now() }),
      );
    } catch (_) {}
    return version;
  } catch (e) {
    console.warn("fetchLatestBaileysVersion failed:", e.message);
    cachedWaVersion = [2, 3000, 1025190524];
    return cachedWaVersion;
  }
}

async function destroySock() {
  const s = sock;
  sock = null;
  if (!s) return;
  try {
    s.ev.removeAllListeners("connection.update");
    s.ev.removeAllListeners("creds.update");
    s.ev.removeAllListeners("messages.upsert");
    s.ev.removeAllListeners("messaging-history.set");
    s.ev.removeAllListeners("chats.upsert");
    s.ev.removeAllListeners("chats.update");
  } catch (_) {}
  try {
    await s.end(undefined);
  } catch (_) {}
}

function phoneFromJid(jid) {
  if (!jid) return null;
  const user = String(jid).split("@")[0].split(":")[0];
  if (/^\d{7,15}$/.test(user)) return `+${user}`;
  return null;
}

function toBaileysJid(chatId) {
  const raw = String(chatId || "").trim();
  if (!raw) return "";
  if (raw.endsWith("@g.us") || raw.endsWith("@s.whatsapp.net") || raw.endsWith("@lid")) {
    return raw;
  }
  if (raw.endsWith("@c.us")) {
    return `${raw.slice(0, -5)}@s.whatsapp.net`;
  }
  const digits = raw.replace(/\D/g, "");
  if (digits) return `${digits}@s.whatsapp.net`;
  return raw;
}

function toCrmChatId(jid, phone) {
  const raw = String(jid || "");
  if (raw.endsWith("@g.us")) return raw;
  const fromPhone = String(phone || "").replace(/\D/g, "");
  if (fromPhone) return `${fromPhone}@c.us`;
  const user = raw.split("@")[0].split(":")[0];
  if (/^\d{7,15}$/.test(user)) return `${user}@c.us`;
  return raw;
}

async function resolvePhone(msg, isGroup) {
  const key = msg.key || {};
  const candidates = [];
  if (isGroup) {
    candidates.push(key.participantAlt, key.participantPn, key.participant, msg.participant);
  } else {
    candidates.push(key.remoteJidAlt, key.senderPn, key.remoteJid);
  }
  for (const c of candidates) {
    const p = phoneFromJid(c);
    if (p) return p;
  }
  const lidJid = isGroup
    ? (String(key.participant || "").endsWith("@lid") ? key.participant : null)
    : (String(key.remoteJid || "").endsWith("@lid") ? key.remoteJid : null);
  if (lidJid && sock?.signalRepository?.lidMapping?.getPNForLID) {
    try {
      const pn = await sock.signalRepository.lidMapping.getPNForLID(lidJid);
      const p = phoneFromJid(pn);
      if (p) return p;
    } catch (_) {}
  }
  return null;
}

function postJson(url, data, attempt = 1, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + (u.search || ""),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "X-Wa-Bridge-Token": BRIDGE_TOKEN,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          if (res.statusCode >= 500 && attempt < 4) {
            setTimeout(() => {
              postJson(url, data, attempt + 1, timeoutMs).then(resolve, reject);
            }, 400 * attempt);
            return;
          }
          if (res.statusCode >= 400) {
            reject(new Error(`webhook HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(raw || "{}"));
          } catch {
            resolve({ ok: true });
          }
        });
      },
    );
    req.on("error", (err) => {
      if (attempt < 4) {
        setTimeout(() => {
          postJson(url, data, attempt + 1, timeoutMs).then(resolve, reject);
        }, 400 * attempt);
        return;
      }
      reject(err);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("webhook timeout")));
    req.write(body);
    req.end();
  });
}

function unwrap(message) {
  if (!message) return null;
  return (
    message.ephemeralMessage?.message ||
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.viewOnceMessageV2Extension?.message ||
    message.documentWithCaptionMessage?.message ||
    message
  );
}

function extractContent(message) {
  const m = unwrap(message);
  if (!m) return null;
  if (m.imageMessage) {
    const mime = m.imageMessage.mimetype || "image/jpeg";
    return {
      msgType: "image",
      hasMedia: true,
      mediaKind: "image",
      mimeType: mime,
      fileName: mime.includes("png") ? "photo.png" : "photo.jpg",
      caption: m.imageMessage.caption || "",
      body: "",
    };
  }
  if (m.audioMessage) {
    const ptt = Boolean(m.audioMessage.ptt);
    return {
      msgType: ptt ? "ptt" : "audio",
      hasMedia: true,
      mediaKind: ptt ? "voice" : "audio",
      mimeType: m.audioMessage.mimetype || "audio/ogg; codecs=opus",
      fileName: ptt ? "voice.ogg" : "audio.ogg",
      caption: "",
      body: "",
    };
  }
  if (m.documentMessage) {
    const mime = m.documentMessage.mimetype || "application/octet-stream";
    const fileName = m.documentMessage.fileName || "file";
    const image = mime.startsWith("image/");
    return {
      msgType: "document",
      hasMedia: true,
      mediaKind: image ? "image" : "file",
      mimeType: mime,
      fileName,
      caption: m.documentMessage.caption || "",
      body: "",
    };
  }
  if (m.videoMessage) {
    return {
      msgType: "video",
      hasMedia: false,
      mediaKind: null,
      mimeType: m.videoMessage.mimetype || "video/mp4",
      fileName: "",
      caption: m.videoMessage.caption || "",
      body: "",
      skipDownload: true,
    };
  }
  if (m.stickerMessage) return null;
  if (m.conversation) {
    return {
      msgType: "chat",
      hasMedia: false,
      mediaKind: null,
      mimeType: "",
      fileName: "",
      caption: "",
      body: m.conversation,
    };
  }
  if (m.extendedTextMessage) {
    return {
      msgType: "chat",
      hasMedia: false,
      mediaKind: null,
      mimeType: "",
      fileName: "",
      caption: "",
      body: m.extendedTextMessage.text || "",
    };
  }
  return null;
}

function extFor(content) {
  if (content.mediaKind === "voice" || content.mediaKind === "audio") return "ogg";
  const mime = String(content.mimeType || "");
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (content.mediaKind === "image") return "jpg";
  const name = String(content.fileName || "");
  const dot = name.lastIndexOf(".");
  if (dot > 0 && name.length - dot <= 8) {
    return name.slice(dot + 1).replace(/[^\w]/g, "").slice(0, 8) || "bin";
  }
  return "bin";
}

async function downloadMediaWithTimeout(msg, timeoutMs = 35000) {
  const dl = downloadMediaMessage(
    msg,
    "buffer",
    {},
    { logger, reuploadRequest: sock.updateMediaMessage },
  );
  const timer = sleep(timeoutMs).then(() => {
    throw new Error(`downloadMedia timeout ${timeoutMs}ms`);
  });
  return Promise.race([dl, timer]);
}

async function downloadMediaWithRetries(msg, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      if (i > 0) await sleep(800 * i);
      const buffer = await downloadMediaWithTimeout(msg);
      if (buffer && buffer.length > 20) return buffer;
      lastErr = new Error("empty media buffer");
    } catch (err) {
      lastErr = err;
      console.error(`downloadMedia attempt ${i + 1}/${attempts}:`, err.message);
    }
  }
  throw lastErr || new Error("downloadMedia failed");
}

async function saveIncoming(msg, messageId, content) {
  const buffer = await downloadMediaWithRetries(msg);
  if (buffer.length > MEDIA_MAX) throw new Error("media too large");
  const safeId = String(messageId).replace(/[^\w.-]/g, "_").slice(0, 80);
  const mediaPath = path.join(INCOMING_DIR, `${safeId}.${extFor(content)}`);
  fs.writeFileSync(mediaPath, buffer);
  return mediaPath;
}

function underDataRoot(filePath) {
  const root = path.resolve(DATA_ROOT);
  const full = path.resolve(String(filePath || ""));
  return full === root || full.startsWith(root + path.sep);
}

function toNum(value) {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object" && typeof value.toNumber === "function") {
    try {
      return value.toNumber();
    } catch (_) {
      return 0;
    }
  }
  if (typeof value === "object" && typeof value.low === "number") {
    return value.low >>> 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function stampMs(value) {
  const raw = toNum(value);
  if (!raw) return 0;
  return raw > 1e12 ? raw : raw * 1000;
}

function isYoungerThanFiveDays(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return false;
  if (ms > now + 10 * 60 * 1000) return false;
  return now - ms < FIVE_DAYS_MS;
}

function normJid(jid) {
  const raw = String(jid || "");
  const at = raw.indexOf("@");
  if (at < 0) return "";
  const host = raw.slice(at + 1);
  const bare = raw.slice(0, at).split(":")[0];
  if (!bare || !host) return "";
  if (host === "c.us") return `${bare}@s.whatsapp.net`;
  return `${bare}@${host}`;
}

function isDirectJid(jid) {
  if (!jid || jid === "status@broadcast") return false;
  if (jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) {
    return false;
  }
  return (
    jid.endsWith("@s.whatsapp.net") ||
    jid.endsWith("@lid") ||
    jid.endsWith("@c.us")
  );
}

function isSelfJid(jid) {
  const me = normJid(sock?.user?.id || "");
  return Boolean(me) && normJid(jid) === me;
}

function allowHistorySync(notification) {
  const kind = notification?.syncType;
  if (kind === undefined || kind === null) return false;
  return Number(kind) !== HISTORY_FULL;
}

const youngChats = new Map();
let youngScanTimer = null;
let youngScanning = false;
let youngScanAgain = false;
let sawYoungHistory = false;
let liveReleased = true;
let liveQueue = [];
let liveHoldGen = 0;
const historyWaiters = [];

function youngEntry(jid) {
  let row = youngChats.get(jid);
  if (!row) {
    row = {
      jid,
      conversationTs: 0,
      name: "",
      msgs: new Map(),
      old: false,
      decided: false,
      pageTries: 0,
      emptyScans: 0,
      importTries: 0,
    };
    youngChats.set(jid, row);
  }
  return row;
}

function resetYoungChats() {
  youngChats.clear();
}

function noteMessage(msg) {
  const remote = normJid(msg?.key?.remoteJid);
  if (!isDirectJid(remote) || isSelfJid(remote)) return;
  const row = youngEntry(remote);
  if (row.decided || row.old) return;
  const ms = stampMs(msg?.messageTimestamp);
  if (ms && !isYoungerThanFiveDays(ms)) {
    row.old = true;
    row.decided = true;
    row.msgs.clear();
    return;
  }
  const id = String(msg?.key?.id || "");
  if (id && row.msgs.size < 200) row.msgs.set(id, msg);
  const push = String(msg?.pushName || "").trim();
  if (push && !row.name) row.name = push;
}

function noteChat(chat) {
  const remote = normJid(chat?.id);
  if (!isDirectJid(remote) || isSelfJid(remote)) return;
  const row = youngEntry(remote);
  const ts = stampMs(chat?.conversationTimestamp);
  if (ts && ts > row.conversationTs) row.conversationTs = ts;
  const name = String(chat?.name || chat?.displayName || "").trim();
  if (name && !row.name) row.name = name;
  if (ts && !isYoungerThanFiveDays(ts)) {
    row.old = true;
    row.decided = true;
    row.msgs.clear();
    return;
  }
  const nested = Array.isArray(chat?.messages) ? chat.messages : [];
  for (const item of nested) noteMessage(item?.message || item);
}

function markHistoryTouch(jid) {
  const id = normJid(jid);
  if (!id) return;
  const row = youngChats.get(id);
  if (!row) return;
  row.touch = (row.touch || 0) + 1;
}

function wakeHistoryWaiters() {
  for (const fn of [...historyWaiters]) fn();
}

function waitForHistory(ms, ready) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => settle(false), ms);
    function settle(ok) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const at = historyWaiters.indexOf(onHistory);
      if (at >= 0) historyWaiters.splice(at, 1);
      resolve(ok);
    }
    function onHistory() {
      if (!ready || ready()) settle(true);
    }
    historyWaiters.push(onHistory);
  });
}

function scheduleYoungImport(reason) {
  if (youngScanTimer) clearTimeout(youngScanTimer);
  youngScanTimer = setTimeout(() => {
    youngScanTimer = null;
    runYoungImport(reason).catch((e) => {
      console.error("young-chat import failed");
      if (e && e.message) console.error("young-chat:", String(e.message).slice(0, 120));
    });
  }, 3000);
}

function oldestStored(row) {
  let oldest = null;
  let oldestMs = 0;
  for (const msg of row.msgs.values()) {
    const ms = stampMs(msg?.messageTimestamp);
    if (!ms) continue;
    if (!oldest || ms < oldestMs) {
      oldest = msg;
      oldestMs = ms;
    }
  }
  return { msg: oldest, ms: oldestMs };
}

function releaseLive(gen) {
  if (gen !== liveHoldGen) return;
  if (liveReleased) return;
  liveReleased = true;
  const queued = liveQueue;
  liveQueue = [];
  for (const msg of queued) {
    handleMessage(msg).catch((e) => console.error("handleMessage:", e.message));
  }
}

function armLiveHold() {
  liveHoldGen += 1;
  const gen = liveHoldGen;
  liveReleased = false;
  liveQueue = [];
  setTimeout(() => releaseLive(gen), 25000);
}

function holdLive(msg) {
  if (liveQueue.length < 500) liveQueue.push(msg);
}

async function confirmChatStart(row) {
  const { msg: oldest, ms } = oldestStored(row);
  if (ms && !isYoungerThanFiveDays(ms)) {
    row.old = true;
    row.decided = true;
    row.msgs.clear();
    return "old";
  }
  if (!oldest?.key?.id || !sock?.fetchMessageHistory) {
    if (row.msgs.size === 0 && isYoungerThanFiveDays(row.conversationTs)) return "timestamp";
    row.pageTries += 1;
    return "unconfirmed";
  }
  if (row.pageTries >= 3) return "unconfirmed";
  const before = row.msgs.size;
  const beforeMs = ms;
  const touchBefore = row.touch || 0;
  row.pageTries += 1;
  try {
    await sock.fetchMessageHistory(
      50,
      {
        remoteJid: oldest.key.remoteJid || row.jid,
        fromMe: Boolean(oldest.key.fromMe),
        id: oldest.key.id,
        participant: oldest.key.participant,
      },
      ms,
    );
  } catch (_) {
    console.error("young-chat history page failed");
    return "unconfirmed";
  }
  const grew = () =>
    row.old ||
    row.msgs.size > before ||
    (oldestStored(row).ms > 0 && oldestStored(row).ms < beforeMs);
  const touched = () => (row.touch || 0) !== touchBefore;
  if (!grew() && !touched()) {
    const arrived = await waitForHistory(3500, () => grew() || touched());
    if (!arrived && !grew() && !touched()) return "unconfirmed";
  }
  if (row.old) return "old";
  const next = oldestStored(row);
  if (next.ms && !isYoungerThanFiveDays(next.ms)) {
    row.old = true;
    row.decided = true;
    row.msgs.clear();
    return "old";
  }
  if (row.msgs.size <= before && (!next.ms || next.ms >= beforeMs)) return "start";
  return "more";
}

async function payloadForHistory(msg, chatIdHint) {
  if (!msg?.message || !msg?.key?.id) return null;
  const remote = msg.key.remoteJid;
  if (!remote || remote === "status@broadcast" || String(remote).endsWith("@g.us")) return null;
  const content = extractContent(msg.message);
  if (!content) return null;
  const text = (content.body || "").trim();
  const caption = (content.caption || "").trim();
  if (content.skipDownload && !text && !caption) return null;
  if (!content.hasMedia && !text && !caption) return null;
  const ms = stampMs(msg.messageTimestamp);
  if (!isYoungerThanFiveDays(ms)) return null;
  const isGroup = false;
  const from = await resolvePhone(msg, isGroup);
  const chatId = chatIdHint || toCrmChatId(remote, from);
  let mediaPath = null;
  if (content.hasMedia && !content.skipDownload) {
    try {
      const buffer = await downloadMediaWithTimeout(msg, 8000);
      if (buffer && buffer.length > 20 && buffer.length <= MEDIA_MAX) {
        const safeId = String(msg.key.id).replace(/[^\w.-]/g, "_").slice(0, 80);
        mediaPath = path.join(INCOMING_DIR, `${safeId}.${extFor(content)}`);
        fs.writeFileSync(mediaPath, buffer);
      }
    } catch (_) {
      mediaPath = null;
    }
  }
  return {
    messageId: msg.key.id,
    chatId,
    contactName: (msg.pushName || "").trim() || null,
    direction: msg.key.fromMe ? "outbound" : "inbound",
    body: text,
    caption,
    mediaKind: content.mediaKind,
    mimeType: content.mimeType || "",
    fileName: content.fileName || "",
    mediaPath,
    timestamp: ms,
    touchThread: false,
  };
}

async function importUnknownChat(row, chatId) {
  const msgs = [...row.msgs.values()].sort(
    (a, b) => stampMs(a?.messageTimestamp) - stampMs(b?.messageTimestamp),
  );
  const payloads = [];
  let mediaLeft = 8;
  for (const msg of msgs) {
    if (payloads.length >= 120) break;
    const content = msg?.message ? extractContent(msg.message) : null;
    const source = content?.hasMedia && mediaLeft <= 0 ? stripMedia(msg) : msg;
    const built = await payloadForHistory(source, chatId);
    if (!built) continue;
    if (built.mediaPath) mediaLeft -= 1;
    payloads.push(built);
  }
  if (!payloads.length) return false;
  payloads[payloads.length - 1].touchThread = true;
  const earliest = stampMs(msgs[0]?.messageTimestamp) || row.conversationTs;
  const assign = payloads.some((item) => item.direction === "inbound");
  const name = row.name || payloads.find((item) => item.contactName)?.contactName || null;
  const chunk = 25;
  for (let i = 0; i < payloads.length; i += chunk) {
    const slice = payloads.slice(i, i + chunk);
    const res = await postJson(
      WEBHOOK_URL,
      {
        type: "history-import",
        chatId,
        contactName: name,
        earliestMs: earliest,
        continueImport: i > 0,
        assign,
        messages: slice,
      },
      1,
      60000,
    );
    if (res?.skipped === "known" || res?.skipped === "old") return res.skipped;
  }
  return "imported";
}

function stripMedia(msg) {
  if (!msg?.message) return msg;
  const content = extractContent(msg.message);
  if (!content?.hasMedia) return msg;
  const clone = {
    ...msg,
    message: {
      conversation: (content.caption || content.body || "").trim() || "📎 Файл",
    },
  };
  return clone;
}

async function runYoungImport() {
  if (!sock || !waState.ready) return;
  if (youngScanning) {
    youngScanAgain = true;
    return;
  }
  youngScanning = true;
  const holdGen = liveHoldGen;
  try {
    const candidates = [];
    for (const row of youngChats.values()) {
      if (row.decided || row.old) continue;
      const last = Math.max(row.conversationTs, oldestStored(row).ms ? stampMsMax(row) : 0);
      if (row.conversationTs && !isYoungerThanFiveDays(row.conversationTs) && !row.msgs.size) {
        row.old = true;
        row.decided = true;
        continue;
      }
      if (last && !isYoungerThanFiveDays(last) && row.msgs.size === 0) {
        row.old = true;
        row.decided = true;
        continue;
      }
      candidates.push(row);
    }
    const ready = [];
    for (const row of candidates.slice(0, 40)) {
      let state = "more";
      for (let page = 0; page < 3 && state === "more"; page++) {
        state = await confirmChatStart(row);
      }
      if (state === "old") continue;
      if (state === "start" && row.msgs.size) ready.push(row);
      else if (!row.msgs.size) {
        row.emptyScans += 1;
        if (row.emptyScans >= 8) row.decided = true;
      } else if (row.pageTries >= 3) {
        row.decided = true;
      }
    }
    if (candidates.length > 40) scheduleYoungImport("rest");
    let retry = false;
    for (const row of youngChats.values()) {
      if (!row.decided && !row.old && row.msgs.size && row.pageTries < 3) retry = true;
    }
    if (retry) scheduleYoungImport("retry");
    if (!ready.length) return;
    const listed = [];
    for (const row of ready) {
      const sample = [...row.msgs.values()][0];
      let chatId = "";
      if (sample) {
        const from = await resolvePhone(sample, false);
        chatId = toCrmChatId(sample.key?.remoteJid || row.jid, from);
      } else {
        chatId = toCrmChatId(row.jid, null);
      }
      if (!chatId || chatId.endsWith("@g.us")) {
        row.decided = true;
        continue;
      }
      row.crmChatId = chatId;
      listed.push({ chatId });
    }
    if (!listed.length) return;
    const probe = await postJson(WEBHOOK_URL, {
      type: "young-chat-probe",
      chats: listed,
    });
    const unknown = new Set(
      (Array.isArray(probe?.unknown) ? probe.unknown : []).map((id) => String(id)),
    );
    let imported = 0;
    let known = 0;
    for (const row of ready) {
      if (!row.crmChatId) continue;
      if (!unknown.has(row.crmChatId)) {
        row.decided = true;
        known += 1;
        row.msgs.clear();
        continue;
      }
      try {
        const result = await importUnknownChat(row, row.crmChatId);
        if (result === "imported" || result === "known" || result === "old") {
          row.decided = true;
          row.msgs.clear();
        } else {
          row.importTries += 1;
          if (row.importTries >= 3) row.decided = true;
        }
        if (result === "imported") imported += 1;
        else if (result === "known") known += 1;
      } catch (_) {
        row.importTries += 1;
        if (row.importTries >= 3) row.decided = true;
        console.error("young-chat post failed");
      }
    }
    console.log(`young-chat: imported=${imported} known=${known}`);
  } finally {
    youngScanning = false;
    let pending = false;
    for (const row of youngChats.values()) {
      if (!row.decided && !row.old && row.msgs.size) pending = true;
    }
    if (sawYoungHistory && !pending) releaseLive(holdGen);
    if (youngScanAgain) {
      youngScanAgain = false;
      scheduleYoungImport("again");
    }
  }
}

function stampMsMax(row) {
  let max = 0;
  for (const msg of row.msgs.values()) {
    const ms = stampMs(msg?.messageTimestamp);
    if (ms > max) max = ms;
  }
  return max;
}

async function handleMessage(msg, maxAgeSec = RECENT_WINDOW_SEC) {
  try {
    if (!msg.message) return;
    const remote = msg.key?.remoteJid;
    if (!remote || remote === "status@broadcast") return;
    const ts = toNum(msg.messageTimestamp);
    const tsSec = ts > 1e12 ? Math.floor(ts / 1000) : ts;
    if (tsSec) {
      const age = Math.floor(Date.now() / 1000) - tsSec;
      if (age > maxAgeSec) return;
    }

    const content = extractContent(msg.message);
    if (!content) return;
    const text = (content.body || "").trim();
    const caption = (content.caption || "").trim();
    if (content.skipDownload && !text && !caption) return;
    if (!content.hasMedia && !text && !caption) return;

    const isGroup = remote.endsWith("@g.us");
    const from = await resolvePhone(msg, isGroup);
    const chatId = toCrmChatId(remote, isGroup ? null : from);
    const direction = msg.key.fromMe ? "outbound" : "inbound";

    let mediaPath = null;
    if (content.hasMedia && !content.skipDownload) {
      try {
        mediaPath = await saveIncoming(msg, msg.key.id, content);
      } catch (err) {
        console.error("downloadMedia failed:", err.message);
      }
    }

    console.log(
      "message:",
      direction,
      isGroup ? "group" : "dm",
      content.mediaKind || "text",
    );

    await postJson(WEBHOOK_URL, {
      type: "message",
      messageId: msg.key.id,
      chatId,
      contactName: (msg.pushName || "").trim() || null,
      direction,
      body: text,
      caption,
      mediaKind: content.mediaKind,
      mimeType: content.mimeType || "",
      fileName: content.fileName || "",
      mediaPath,
      timestamp: tsSec || Math.floor(Date.now() / 1000),
    });
  } catch (e) {
    console.error("message error", e.message);
  }
}

async function startSock() {
  if (starting) return;
  starting = true;
  clearReconnectTimer();
  try {
    await destroySock();
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const version = await resolveWaVersion();
    console.log("Baileys WA version:", version.join("."));

    sock = makeWASocket({
      version,
      auth: state,
      logger,
      browser: Browsers.macOS("Chrome"),
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: (msg) => allowHistorySync(msg),
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      retryRequestDelayMs: 2000,
      defaultQueryTimeoutMs: 60000,
      getMessage: async () => undefined,
      qrTimeout: 90000,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        waState.ready = false;
        waState.connectionState = "QR";
        try {
          waState.qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, width: 320 });
        } catch (e) {
          waState.qrDataUrl = null;
          waState.error = e.message;
        }
        console.log("WhatsApp QR updated");
        publishState();
      }

      if (connection === "open") {
        reconnectAttempt = 0;
        badSessionStrikes = 0;
        waState.ready = true;
        waState.qrDataUrl = null;
        waState.error = null;
        waState.connectionState = "CONNECTED";
        const uid = sock.user?.id || "";
        waState.phone =
          phoneFromJid(uid) ||
          (uid ? `+${uid.split(":")[0].split("@")[0]}` : null);
        waState.name = sock.user?.name || sock.user?.verifiedName || null;
        console.log("WhatsApp client ready:", waState.phone || "no-phone");
        publishState();
        armLiveHold();
        scheduleYoungImport("open");
      }

      if (connection === "close") {
        waState.ready = false;
        waState.connectionState = "DISCONNECTED";
        const code = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.message || String(code);
        waState.error = reason;
        console.error("connection closed:", code);
        publishState();
        starting = false;
        if (skipAutoReconnect) return;

        if (code === DisconnectReason.loggedOut) {
          console.log("Logged out — wiping session");
          await wipeSession();
          waState.phone = null;
          waState.name = null;
          reconnectAttempt = 0;
          scheduleReconnect(5000, "loggedOut");
          return;
        }

        if (code === DisconnectReason.restartRequired || code === 515) {
          const hasCreds = fs.existsSync(path.join(SESSION_DIR, "creds.json"));
          waState.connectionState = "LOGGING_IN";
          waState.qrDataUrl = null;
          waState.error = null;
          publishState();
          scheduleReconnect(hasCreds ? 2500 : 5000, "restartRequired");
          return;
        }

        if (code === DisconnectReason.badSession) {
          badSessionStrikes += 1;
          if (badSessionStrikes >= 3) {
            await wipeSession();
            badSessionStrikes = 0;
            reconnectAttempt = 0;
            scheduleReconnect(5000, "badSession wipe");
          } else {
            scheduleReconnect(4000, "badSession retry");
          }
          return;
        }

        const hasCreds = fs.existsSync(path.join(SESSION_DIR, "creds.json"));
        if (
          code === DisconnectReason.timedOut &&
          /QR refs attempts ended/i.test(String(reason))
        ) {
          if (!hasCreds) {
            await wipeSession();
            waState.qrDataUrl = null;
            waState.error = null;
            reconnectAttempt = 0;
            scheduleReconnect(2000, "qrRefsEnded");
          } else {
            scheduleReconnect(3000, "qrRefs with creds");
          }
          return;
        }

        scheduleReconnect(5000, `disconnect code=${code}`);
      }
    });

    const CATCHUP_WINDOW_SEC = 6 * 60 * 60;

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      for (const msg of messages || []) noteMessage(msg);
      const live = type === "notify";
      if (!live) {
        for (const msg of messages || []) markHistoryTouch(msg?.key?.remoteJid);
        wakeHistoryWaiters();
        scheduleYoungImport("append");
      }
      for (const msg of messages || []) {
        if (!liveReleased) {
          if (live) holdLive(msg);
          continue;
        }
        // «append» — догон, пока сокет был офлайн. Живые notify идут как раньше.
        // Окно 6 часов закрывает строки, которые Green API в журнал не положил.
        const maxAge = live ? RECENT_WINDOW_SEC : CATCHUP_WINDOW_SEC;
        handleMessage(msg, maxAge).catch((e) => console.error("handleMessage:", e.message));
      }
    });

    sock.ev.on("messaging-history.set", (payload) => {
      sawYoungHistory = true;
      for (const chat of payload?.chats || []) {
        noteChat(chat);
        markHistoryTouch(chat?.id);
      }
      const catchup = [];
      for (const msg of payload?.messages || []) {
        const wa = msg?.key ? msg : msg?.message?.key ? msg.message : null;
        if (wa) noteMessage(wa);
        markHistoryTouch(wa?.key?.remoteJid);
        if (wa && !wa.key?.fromMe) catchup.push(wa);
      }
      catchup.sort((a, b) => stampMs(b?.messageTimestamp) - stampMs(a?.messageTimestamp));
      for (const wa of catchup.slice(0, 80)) {
        if (!liveReleased) break;
        handleMessage(wa, CATCHUP_WINDOW_SEC).catch((e) => console.error("handleMessage:", e.message));
      }
      wakeHistoryWaiters();
      scheduleYoungImport("history");
    });

    sock.ev.on("chats.upsert", (chats) => {
      for (const chat of chats || []) noteChat(chat);
      scheduleYoungImport("chats");
    });

    sock.ev.on("chats.update", (chats) => {
      for (const chat of chats || []) noteChat(chat);
      scheduleYoungImport("chats");
    });
  } catch (err) {
    starting = false;
    waState.error = err.message;
    publishState();
    console.error("startSock failed:", err.message);
    scheduleReconnect(5000, "startSock failed");
  } finally {
    starting = false;
  }
}

async function wipeSession() {
  try {
    if (fs.existsSync(SESSION_DIR)) {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    }
  } catch (e) {
    console.warn("wipeSession:", e.message);
  }
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  resetYoungChats();
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 262144) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function sendContent(jid, body) {
  const caption = String(body.message || "");
  if (body.mediaPath) {
    if (!underDataRoot(body.mediaPath)) {
      throw new Error("media path rejected");
    }
    const buf = fs.readFileSync(body.mediaPath);
    if (buf.length > MEDIA_MAX) throw new Error("file too large");
    const kind = String(body.mediaKind || "file");
    const mime = String(body.mimeType || "application/octet-stream");
    const fileName = String(body.fileName || path.basename(body.mediaPath));
    if (kind === "image" || mime.startsWith("image/")) {
      return sock.sendMessage(jid, {
        image: buf,
        caption: caption || undefined,
        mimetype: mime,
      });
    }
    if (kind === "voice" || kind === "audio") {
      return sock.sendMessage(jid, {
        audio: buf,
        mimetype: mime.includes("ogg") ? mime : "audio/ogg; codecs=opus",
        ptt: kind === "voice",
      });
    }
    return sock.sendMessage(jid, {
      document: buf,
      mimetype: mime,
      fileName,
      caption: caption || undefined,
    });
  }
  if (!caption.trim()) throw new Error("empty message");
  return sock.sendMessage(jid, { text: caption });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, bridge: "baileys" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/status") {
      sendJson(res, 200, {
        bridge: "baileys",
        ready: waState.ready,
        phone: waState.phone,
        name: waState.name,
        error: waState.error,
        qrDataUrl: waState.qrDataUrl,
        connectionState: waState.connectionState,
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/send") {
      if (!sock || !waState.ready) {
        sendJson(res, 503, {
          ok: false,
          error: `WhatsApp state: ${waState.connectionState}`,
        });
        return;
      }
      const body = await readBody(req);
      const jid = toBaileysJid(body.chatId);
      if (!jid) {
        sendJson(res, 400, { ok: false, error: "chatId required" });
        return;
      }
      const sent = await sendContent(jid, body);
      sendJson(res, 200, { ok: true, messageId: sent?.key?.id || null });
      return;
    }
    if (req.method === "POST" && url.pathname === "/delete") {
      if (!sock || !waState.ready) {
        sendJson(res, 503, { ok: false, error: "not connected" });
        return;
      }
      const body = await readBody(req);
      const jid = toBaileysJid(body.chatId);
      const messageId = String(body.messageId || "");
      if (!jid || !messageId) {
        sendJson(res, 400, { ok: false, error: "chatId and messageId required" });
        return;
      }
      await sock.sendMessage(jid, {
        delete: { remoteJid: jid, fromMe: true, id: messageId },
      });
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/restart") {
      const body = await readBody(req).catch(() => ({}));
      if (waState.connectionState === "LOGGING_IN" && !body.force) {
        sendJson(res, 409, {
          ok: false,
          error: "Идёт вход после скана — подождите",
          connectionState: waState.connectionState,
        });
        return;
      }
      skipAutoReconnect = true;
      clearReconnectTimer();
      waState.error = null;
      waState.qrDataUrl = null;
      waState.ready = false;
      waState.phone = null;
      waState.connectionState = "RESTART";
      publishState();
      await destroySock();
      await wipeSession();
      await sleep(1000);
      skipAutoReconnect = false;
      startSock().catch((e) => {
        waState.error = e.message;
        publishState();
      });
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 404, { ok: false, error: "not found" });
  } catch (err) {
    console.error("http:", err.message);
    if (!res.headersSent) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection", reason && reason.message ? reason.message : reason);
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException", err.message);
});

publishState();
setInterval(publishState, 30000);

server.on("error", (err) => {
  console.error("bridge listen:", err.message);
  process.exit(1);
});

server.listen(WA_PORT, "127.0.0.1", () => {
  console.log(`WA bridge (Baileys) on 127.0.0.1:${WA_PORT}`);
  startSock().catch((err) => {
    waState.error = err.message;
    publishState();
    console.error("startSock fatal:", err.message);
  });
});
