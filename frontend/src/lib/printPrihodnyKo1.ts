/** Печать приходного кассового ордера КО-1 (половина A4) для клиники. */

export type PrihodnyKo1Input = {
  patientName: string;
  amount: number;
  /** YYYY-MM-DD */
  dateIso: string;
  /** Текст услуги / основания (без «Шартномаи») */
  serviceTitle?: string | null;
  /**
   * Явный № шартнома. Если не задан — авто: свой номер на каждую запись
   * (повторная печать той же записи даёт тот же №).
   */
  contractNo?: number | string | null;
  /** Id записи — для стабильного авто-номера шартнома */
  appointmentId?: number | null;
  /** Порядковый № ордера; по умолчанию из localStorage за день */
  docSeq?: number | null;
  orgName?: string;
};

const ORG_DEFAULT = "ҶДММ «МЕТОДӢ»";

const MONTHS = [
  "",
  "январи",
  "феврали",
  "марти",
  "апрели",
  "майи",
  "июни",
  "июли",
  "августи",
  "сентябри",
  "октябри",
  "ноябри",
  "декабри",
];
const ones = ["", "як", "ду", "се", "чор", "панҷ", "шаш", "ҳафт", "ҳашт", "нуҳ"];
const teens = [
  "даҳ",
  "ёздаҳ",
  "дувоздаҳ",
  "сездаҳ",
  "чордаҳ",
  "понздаҳ",
  "шонздаҳ",
  "ҳабдаҳ",
  "ҳаждаҳ",
  "нуздаҳ",
];
const tens = ["", "даҳ", "бист", "си", "чил", "панҷоҳ", "шаст", "ҳафтод", "ҳаштод", "навад"];
const hundreds = [
  "",
  "сад",
  "дусад",
  "сесад",
  "чорсад",
  "панҷсад",
  "шашсад",
  "ҳафтсад",
  "ҳаштсад",
  "нуҳсад",
];

function under1000(n: number): string {
  n = Math.floor(n);
  if (n <= 0) return "";
  const h = Math.floor(n / 100);
  const r = n % 100;
  let out = hundreds[h] || "";
  if (r >= 10 && r <= 19) out = (out ? out + " " : "") + teens[r - 10];
  else {
    const t = Math.floor(r / 10);
    const o = r % 10;
    if (t) out = (out ? out + " " : "") + tens[t];
    if (o) out = (out ? out + " " : "") + ones[o];
  }
  return out.trim();
}

function amountWords(amount: number): string {
  const n = Math.round(Number(amount) || 0);
  if (!n) return "сифр сомонӣ";
  const th = Math.floor(n / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (th === 1) parts.push(rest ? "ҳазору" : "як ҳазор");
  else if (th > 1) parts.push(under1000(th) + (rest ? " ҳазору" : " ҳазор"));
  if (rest) parts.push(under1000(rest));
  return (parts.join(" ") + " сомонӣ").replace(/\s+/g, " ").trim();
}

function money(n: number): string {
  return Number(n || 0).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function shortDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(-2)}`;
}

function softBreakWord(word: string, maxLen: number): string[] {
  if (word.length <= maxLen) return [word];
  const parts: string[] = [];
  let rest = word;
  while (rest.length > maxLen) {
    parts.push(rest.slice(0, maxLen - 1) + "-");
    rest = rest.slice(maxLen - 1);
  }
  if (rest) parts.push(rest);
  return parts;
}

function splitToLines(text: string, maxLen: number, count: number): string[] {
  const raw = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const wordsArr: string[] = [];
  for (const w of raw) softBreakWord(w, maxLen).forEach((p) => wordsArr.push(p));
  const chunks: string[] = [];
  let cur = "";
  for (const w of wordsArr) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxLen && cur) {
      chunks.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) chunks.push(cur);
  while (chunks.length > count) {
    const last = chunks.pop()!;
    chunks[chunks.length - 1] += " " + last;
  }
  while (chunks.length < count) chunks.push("");
  return chunks;
}

function basisLines(text: string, max1: number, maxRest: number): [string, string, string, string] {
  const raw = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const wordsArr: string[] = [];
  for (const w of raw) softBreakWord(w, Math.max(max1, maxRest)).forEach((p) => wordsArr.push(p));
  let line1 = "";
  let i = 0;
  for (; i < wordsArr.length; i++) {
    const next = line1 ? `${line1} ${wordsArr[i]}` : wordsArr[i];
    if (next.length > max1 && line1) break;
    line1 = next;
  }
  const rest = wordsArr.slice(i).join(" ");
  const [l2, l3, l4] = splitToLines(rest, maxRest, 3);
  return [line1, l2, l3, l4];
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CONTRACT_SEQ_KEY = "prihodny-ko1-contract-seq";
const CONTRACT_MAP_KEY = "prihodny-ko1-contract-by-appt";

function nextDocSeq(iso: string): number {
  try {
    const key = `prihodny-ko1-seq:${iso}`;
    const prev = Number(localStorage.getItem(key) || "0") || 0;
    const next = prev + 1;
    localStorage.setItem(key, String(next));
    return next;
  } catch {
    return 1;
  }
}

function bumpContractSeq(): number {
  try {
    const prev = Number(localStorage.getItem(CONTRACT_SEQ_KEY) || "0") || 0;
    const next = prev + 1;
    localStorage.setItem(CONTRACT_SEQ_KEY, String(next));
    return next;
  } catch {
    return 1;
  }
}

/** Свой № шартнома на каждую запись; повторная печать — тот же номер. */
function allocateContractNo(appointmentId?: number | null): number {
  if (appointmentId == null || !Number.isFinite(appointmentId)) {
    return bumpContractSeq();
  }
  try {
    const raw = localStorage.getItem(CONTRACT_MAP_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const key = String(appointmentId);
    if (map[key] != null && Number(map[key]) > 0) return Number(map[key]);
    const next = bumpContractSeq();
    map[key] = next;
    localStorage.setItem(CONTRACT_MAP_KEY, JSON.stringify(map));
    return next;
  } catch {
    return bumpContractSeq();
  }
}

function makeDocNo(iso: string, seq: number): string {
  if (!iso) return String(seq);
  const [, m, d] = iso.split("-");
  return `${seq}/${d}${m}`;
}

/** Можно ли печатать КО-1 по записи (нал + сумма). */
export function canPrintPrihodnyKo1(a: {
  paid_amount?: number | null;
  payment_method?: string | null;
}): boolean {
  return Number(a.paid_amount ?? 0) > 0 && String(a.payment_method || "").toLowerCase() === "cash";
}

/** Дата YYYY-MM-DD из ISO datetime или уже date. */
export function toDateIso(value: string | null | undefined): string {
  const s = String(value || "").trim();
  if (!s) {
    const n = new Date();
    const y = n.getFullYear();
    const m = String(n.getMonth() + 1).padStart(2, "0");
    const d = String(n.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return s.slice(0, 10);
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #111; }
  .sheet {
    width: 210mm; height: 148.5mm; margin: 0; background: #fff; color: #111;
    font-family: "Times New Roman", Times, serif; font-size: 12.5px; line-height: 1.25;
    padding: 12mm 7mm 6mm; display: grid; grid-template-columns: 1.55fr 18px 0.95fr;
    column-gap: 2mm; overflow: hidden;
  }
  .order, .receipt { min-width: 0; min-height: 0; }
  .cut {
    align-self: start; display: flex; flex-direction: row; justify-content: center;
    align-items: stretch; gap: 3px; width: 100%; height: 70%; min-height: 120px;
  }
  .cut-rail { display: flex; flex-direction: column; align-items: center; width: 2px; height: 100%; flex: 0 0 2px; }
  .cut-seg { flex: 1 1 auto; width: 0; border-left: 1px dashed #111; min-height: 6px; }
  .cut-gap { flex: 0 0 auto; height: var(--cut-label-h, 72px); }
  .cut-label {
    writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap;
    font-size: 9px; letter-spacing: 0.14em; color: #111; line-height: 1; align-self: center;
  }
  .org { font-weight: 700; font-size: 14px; border-bottom: 1px solid #111; display: inline-block; min-width: 55%; }
  .org-sub { font-size: 10px; color: #444; margin-top: 2px; }
  .top { display: flex; justify-content: space-between; gap: 6px; align-items: flex-start; }
  .form-code { text-align: right; font-size: 9.5px; line-height: 1.3; }
  .okud {
    display: inline-block; border: 1px solid #111; padding: 2px 10px; margin-top: 4px;
    min-width: 78px; min-height: 16px;
  }
  .title {
    text-align: center; font-weight: 700; font-size: 15px; letter-spacing: 0.04em;
    margin: 8px 0; text-transform: uppercase;
  }
  table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 8px; }
  table.grid th, table.grid td {
    border: 1px solid #111; padding: 3px; text-align: center; vertical-align: middle;
    font-size: 9px; overflow: hidden; word-break: break-word; overflow-wrap: anywhere; line-height: 1.2;
  }
  table.grid th { font-weight: 600; font-size: 8.5px; line-height: 1.15; }
  table.grid td.fill { font-weight: 700; font-size: 12px; height: 24px; white-space: nowrap; overflow: hidden; }
  .line { display: flex; align-items: flex-end; gap: 0.35em; margin-top: 8px; }
  .line .k { flex: 0 0 auto; white-space: nowrap; padding-bottom: 1px; }
  .on-line {
    display: block; flex: 1 1 auto; width: 100%; min-width: 0; border-bottom: 1px solid #111;
    height: 1.55em; padding: 0 3px; font-weight: 700; font-size: 12.5px; line-height: 1.55em;
    overflow: hidden; white-space: nowrap; text-align: center;
  }
  .words { margin-top: 10px; }
  .words .on-line { text-align: center; }
  .words-hint { font-size: 10px; color: #444; margin-top: 2px; text-align: center; display: block; }
  .basis-block { margin-top: 4px; }
  .basis-row1 { display: flex; align-items: baseline; gap: 0.35em; }
  .basis-row1 .k { flex: 0 0 auto; white-space: nowrap; line-height: 1.45em; }
  .basis-row1 .on-line { flex: 1 1 auto; height: 1.5em; line-height: 1.5em; }
  .basis-under { width: 100%; display: flex; flex-direction: column; }
  .basis-under .on-line { height: 1.5em; line-height: 1.5em; }
  .signs-wrap { display: flex; align-items: flex-start; gap: 0.35em; margin-top: 6px; padding-left: 2em; }
  .signs-wrap .signs-spacer { flex: 0 0 auto; visibility: hidden; white-space: nowrap; }
  .signs { flex: 1 1 auto; display: flex; flex-direction: column; align-items: flex-start; gap: 0; min-width: 0; }
  .sign-no-line { margin: 0; line-height: 1.25em; font-size: 12.5px; }
  .sign-with-line { display: flex; flex-direction: column; width: 100%; margin: 0; line-height: 1.25em; font-size: 12.5px; }
  .sign-with-line .sign-line { display: block; width: 100%; border-bottom: 1px solid #111; height: 0; }
  .receipt { text-align: center; }
  .receipt .r-line, .receipt .basis-block, .receipt .words, .receipt .signs {
    padding-left: 1.2em; padding-right: 1.2em;
  }
  .receipt .org { display: block; width: 100%; margin: 0 auto 2px; text-align: center; }
  .receipt .org-sub { text-align: center; display: block; }
  .receipt .kv {
    text-align: center; font-weight: 700; font-size: 14px; letter-spacing: 0.05em;
    margin: 1em 0 10px; text-transform: uppercase;
  }
  .r-line { margin-top: 10px; font-size: 12px; text-align: center; }
  .r-inline {
    display: inline-block; border-bottom: 1px solid #111; font-weight: 700;
    min-height: 1.2em; padding: 0 2px 1px; line-height: 1.2em; text-align: center;
  }
  .r-inline.amt { min-width: 3.8em; } .r-inline.dir { min-width: 2.2em; }
  .r-inline.day { min-width: 1.4em; } .r-inline.mon { min-width: 5em; }
  .r-inline.yr { min-width: 2.6em; } .r-inline.doc { min-width: 4.2em; }
  .r-inline.name { min-width: 75%; max-width: 92%; }
  .receipt .ruled .on-line, .receipt .words .on-line {
    white-space: normal; overflow: visible; word-break: break-word; overflow-wrap: anywhere;
    height: auto; min-height: 1.35em;
  }
  .receipt .signs { margin-top: 14px; text-align: left; }
  .sign-no-line { margin-top: 4px; }
  @media print {
    @page { size: A4 portrait; margin: 0; }
    body { margin: 0; }
    .sheet { box-shadow: none; margin: 0; }
  }
`;

function buildHtml(input: PrihodnyKo1Input): string {
  const org = input.orgName || ORG_DEFAULT;
  const patient = (input.patientName || "").trim();
  const amount = Number(input.amount) || 0;
  const dateIso = toDateIso(input.dateIso);
  const seq = input.docSeq != null ? Number(input.docSeq) : nextDocSeq(dateIso);
  const docNo = makeDocNo(dateIso, seq);
  const contract =
    input.contractNo != null && String(input.contractNo).trim() !== ""
      ? String(input.contractNo).trim()
      : String(allocateContractNo(input.appointmentId));
  const service = (input.serviceTitle || "").trim();
  const basis = service ? `Шартномаи №${contract} ${service}` : `Шартномаи №${contract}`;
  const [o1, o2, o3, o4] = basisLines(basis, 28, 36);
  const [r1, r2, r3, r4] = basisLines(basis, 18, 24);
  const [, m, d] = dateIso.split("-");
  const dash = "—";

  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><title>КО-1 ${escapeHtml(docNo)}</title><style>${PRINT_CSS}</style></head><body>
<div class="sheet" id="sheet">
  <div class="order">
    <div class="top">
      <div>
        <div class="org">${escapeHtml(org)}</div>
        <div class="org-sub">предприятие, организация</div>
      </div>
      <div class="form-code">
        Форма № КО-1<br/>
        По порядку ведения кассовых операций в<br/>
        народном хозяйстве РТ (НБТ от 15.06.1993 № 19)<br/>
        <span class="okud">Код формы по ОКУД 0310001</span>
      </div>
    </div>
    <div class="title">Приходный кассовый ордер</div>
    <table class="grid">
      <thead>
        <tr>
          <th style="width:14%">Номер<br/>доку&shy;мента</th>
          <th style="width:14%">Дата<br/>состав&shy;ления</th>
          <th style="width:18%">Корреспонди&shy;рующий<br/>счёт, субсчёт</th>
          <th style="width:16%">Код аналити&shy;ческого<br/>учёта</th>
          <th style="width:14%">Сумма</th>
          <th style="width:14%">Код целевого<br/>назна&shy;чения</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="fill">${escapeHtml(docNo)}</td>
          <td class="fill">${escapeHtml(shortDate(dateIso))}</td>
          <td class="fill">${dash}</td>
          <td class="fill">${dash}</td>
          <td class="fill">${escapeHtml(money(amount))}</td>
          <td class="fill">${dash}</td>
        </tr>
      </tbody>
    </table>
    <div class="line"><span class="k">Принято от</span><span class="on-line">${escapeHtml(patient)}</span></div>
    <div class="basis-block">
      <div class="basis-row1"><span class="k">Основание:</span><span class="on-line">${escapeHtml(o1)}</span></div>
      <div class="basis-under">
        <span class="on-line">${escapeHtml(o2)}</span>
        <span class="on-line">${escapeHtml(o3)}</span>
        <span class="on-line">${escapeHtml(o4)}</span>
      </div>
    </div>
    <div class="words">
      <span class="on-line">${escapeHtml(amountWords(amount))}</span>
      <div class="words-hint">прописью</div>
    </div>
    <div class="line"><span class="k">Приложение</span><span class="on-line"></span></div>
    <div class="signs-wrap">
      <span class="signs-spacer k">Приложение</span>
      <div class="signs">
        <div class="sign-no-line">Директор</div>
        <div class="sign-with-line">Получил кассир<span class="sign-line"></span></div>
      </div>
    </div>
  </div>
  <div class="cut" id="cutLine">
    <div class="cut-rail"><span class="cut-seg"></span><span class="cut-gap"></span><span class="cut-seg"></span></div>
    <span class="cut-label" id="cutLabel">линия отреза</span>
    <div class="cut-rail"><span class="cut-seg"></span><span class="cut-gap"></span><span class="cut-seg"></span></div>
  </div>
  <div class="receipt">
    <div class="org">${escapeHtml(org)}</div>
    <div class="org-sub">предприятие, организация</div>
    <div class="kv">Квитанция</div>
    <div class="r-line">к приходному кассовому ордеру № <span class="r-inline doc">${escapeHtml(docNo)}</span></div>
    <div class="r-line">Принято от <span class="r-inline name">${escapeHtml(patient)}</span></div>
    <div class="basis-block">
      <div class="basis-row1"><span class="k">Основание:</span><span class="on-line">${escapeHtml(r1)}</span></div>
      <div class="basis-under">
        <span class="on-line">${escapeHtml(r2)}</span>
        <span class="on-line">${escapeHtml(r3)}</span>
        <span class="on-line">${escapeHtml(r4)}</span>
      </div>
    </div>
    <div class="words" style="margin-top:10px">
      <span class="on-line">${escapeHtml(amountWords(amount))}</span>
      <div class="words-hint">прописью</div>
    </div>
    <div class="r-line">
      <span class="r-inline amt">${escapeHtml(money(amount))}</span> сом.
      <span class="r-inline dir"></span> дир.
    </div>
    <div class="r-line">
      <span class="r-inline day">${escapeHtml(String(Number(d) || ""))}</span>
      <span class="r-inline mon">${escapeHtml(MONTHS[Number(m) || 0] || "")}</span>
      <span class="r-inline yr">${escapeHtml(dateIso.slice(0, 4))}</span> г.
    </div>
    <div class="signs">
      <div class="sign-no-line">М. П.</div>
      <div class="sign-no-line">Директор</div>
    </div>
  </div>
</div>
<script>
(function () {
  function syncCut() {
    var order = document.querySelector("#sheet .order");
    var cashier = order && order.querySelector(".sign-with-line");
    var cut = document.getElementById("cutLine");
    var label = document.getElementById("cutLabel");
    if (!order || !cashier || !cut) return;
    var h = Math.max(100, Math.round(cashier.getBoundingClientRect().bottom - order.getBoundingClientRect().top));
    cut.style.height = h + "px";
    if (label) cut.style.setProperty("--cut-label-h", Math.ceil(label.getBoundingClientRect().height) + "px");
  }
  window.addEventListener("load", function () {
    syncCut();
    setTimeout(function () { window.focus(); window.print(); }, 120);
  });
})();
</script>
</body></html>`;
}

/** Открыть окно печати КО-1. */
export function printPrihodnyKo1(input: PrihodnyKo1Input): void {
  const html = buildHtml(input);
  const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
  if (!w) {
    // popup blocked — fallback: blob URL
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
