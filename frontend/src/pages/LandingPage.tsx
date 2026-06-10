import { FormEvent, useEffect, useRef, useState, type ComponentType } from "react";
import { toast } from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import { BarChart3, Calendar, CheckSquare, Funnel, MapPin, MessageCircle, Target, Users, Wallet } from "@/components/icons";

const shots = [
  { src: "/landing/02-kpi-matrix.png", title: "KPI по услугам и менеджерам" },
  { src: "/landing/03-lead-card.png", title: "Карточка клиента" },
  { src: "/landing/04-chat.png", title: "Чат с клиентами" },
  { src: "/landing/07-booking.png", title: "Онлайн-запись" },
  { src: "/landing/08-integrations.png", title: "Интеграции и каналы" },
  { src: "/landing/09-tasks.png", title: "Командные задачи" },
  { src: "/landing/09-tasks.png", title: "Geo-трекер посещаемости" },
  { src: "/landing/10-analytics-detail.png", title: "Детальная аналитика" },
  { src: "/landing/11-analytics-funnel.png", title: "Аналитика по воронкам" },
  { src: "/landing/12-crm-settings.png", title: "Настройки воронки" },
  { src: "/landing/13-crm-board.png", title: "Kanban-доска" },
];

const platformTabs = [
  {
    id: "crm",
    title: "CRM и воронки",
    lead: "Контроль лидов от первого контакта до закрытия сделки.",
    bullets: [
      "Kanban-доска по стадиям с приоритетом диалогов, где клиент ждёт ответ",
      "Карточка лида: история действий, задачи, коммуникации, суммы и статусы",
      "Гибкая настройка воронок, источников, стадий и ответственных",
      "Роли owner/admin/manager/expert и ограничения доступа по направлениям",
    ],
  },
  {
    id: "chat",
    title: "Чаты и коммуникации",
    lead: "Единая работа с клиентскими сообщениями и быстрые ответы.",
    bullets: [
      "Чаты WhatsApp/Telegram/Instagram в одном интерфейсе",
      "Непрочитанные входящие, сортировка по ожидающим ответа",
      "Отправка текста, файлов, голосовых; история сохраняется в CRM",
      "Уведомления о новых сообщениях и смене статусов задач",
    ],
  },
  {
    id: "booking",
    title: "Онлайн-запись",
    lead: "Запись клиентов на услуги без хаоса в расписании.",
    bullets: [
      "Календарь специалистов, слоты, переносы и быстрая запись",
      "Привязка записи к лиду и автоматическая смена стадии",
      "Учет направлений, длительности услуг и загрузки команды",
      "Форма новой записи с контролем воронки и ответственных",
    ],
  },
  {
    id: "kpi",
    title: "KPI и аналитика",
    lead: "Руководитель видит план, факт и результат команды в реальном времени.",
    bullets: [
      "KPI по менеджерам и услугам: план/факт/% выполнения",
      "Аналитика по воронкам, менеджерам и закрытым сделкам",
      "Контроль сумм сделок, допродаж и закрытия менеджерами",
      "Прозрачные отчёты для управленческих решений",
    ],
  },
  {
    id: "integrations",
    title: "Интеграции",
    lead: "Подключайте каналы и данные без переписывания процессов.",
    bullets: [
      "Green API (WhatsApp), Telegram Bot, Instagram/Meta webhook",
      "Google Sheets синхронизация лидов в CRM",
      "Gmail-подключение через app password и IMAP",
      "Панель интеграций с подсказками, секретами и проверкой настроек",
    ],
  },
  {
    id: "tracker",
    title: "Geo-трекер",
    lead: "Контроль выездов и присутствия команды на объектах и в офисе.",
    bullets: [
      "Учёт посещений по геозоне офиса и маршрутам выездов к клиентам",
      "История фиксаций и прозрачность для руководителя и владельца",
      "Снижение спорных ситуаций: факт присутствия привязан ко времени и месту",
      "Работает вместе с задачами и CRM: видно, кто где и что делает",
    ],
  },
] as const;

const targetGroups = [
  {
    title: "Малый бизнес",
    text: "Салоны, сервис, клиники и небольшие отделы продаж, которым нужен порядок без сложного внедрения.",
  },
  {
    title: "Средний бизнес",
    text: "Компании с несколькими менеджерами и направлениями, где важно масштабировать воронки и контроль KPI.",
  },
  {
    title: "Крупный бизнес",
    text: "Сети и холдинги, которым нужны роли, интеграции, прозрачная аналитика и единый стандарт работы.",
  },
];

/** Плитки: в покое — по орбите вокруг заголовка/лида, при скролле — к слотам секций */
const FLY_ICON_BOX = 52;
const FLY_SCATTER_SCALE_MAX = 1.08;
const FLY_SCATTER_SCALE_MIN = 0.96;
/** Зазор от края текста до центра иконки (px) */
const FLY_ORBIT_PAD = 40;
/** Общий сдвиг орбиты ниже блока текста (px) */
const FLY_ORBIT_Y_SHIFT = 66;

function orbitTopLeftAroundCopy(copy: DOMRect, index: number, total: number, half: number): { left: number; top: number } {
  const n = Math.max(1, total);
  const cx = copy.left + copy.width / 2;
  const cy = copy.top + copy.height / 2 + FLY_ORBIT_Y_SHIFT;
  const narrow = copy.width < 420;
  const rx = copy.width / 2 + half + FLY_ORBIT_PAD;
  const ry = copy.height / 2 + half + FLY_ORBIT_PAD + (narrow ? 28 : 0);
  const angle = (index / n) * Math.PI * 2 - Math.PI / 2 + 0.14 * Math.sin(index * 1.73);
  const rw = 1 + 0.075 * Math.sin(index * 2.31);
  const icx = cx + Math.cos(angle) * rx * rw;
  const icy = cy + Math.sin(angle) * ry * rw;
  return { left: icx - half, top: icy - half };
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Плавнее куба — для полёта иконок от орбиты вокруг текста к слотам */
function easeInOutQuint(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 16 * x * x * x * x * x : 1 - Math.pow(-2 * x + 2, 5) / 2;
}

function IconWhatsApp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function IconTelegram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function IconInstagram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2m-.2 2A3.6 3.6 0 0 0 4 7.6v8.8A3.6 3.6 0 0 0 7.6 20h8.8A3.6 3.6 0 0 0 20 16.4V7.6A3.6 3.6 0 0 0 16.4 4H7.6m8.65 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10m0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
      />
    </svg>
  );
}

function IconSheets({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path fill="#0F9D58" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
      <path fill="#87CEAC" d="M14 2v6h6" />
      <path fill="#F1F8E9" d="M8 12h8v2H8v-2zm0 3h8v2H8v-2zm0 3h5v2H8v-2z" />
    </svg>
  );
}

function IconGmail({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#EA4335" d="M2 6.5 12 14l10-7.5V18a2 2 0 0 1-2 2h-3V10.7L12 14.3 7 10.7V20H4a2 2 0 0 1-2-2V6.5z" />
      <path fill="#FBBC05" d="M2 6.5V7l10 7.3L22 7v-.5A2.5 2.5 0 0 0 19.5 4h-15A2.5 2.5 0 0 0 2 6.5z" />
      <path fill="#34A853" d="M7 10.7V20h10v-9.3L12 14.3 7 10.7z" />
      <path fill="#4285F4" d="M2 7v11a2 2 0 0 0 2 2h1v-9.3L2 7zm20 0-3 3.7V20h1a2 2 0 0 0 2-2V7z" />
    </svg>
  );
}

const integrationBadges: Array<{
  label: string;
  Icon: ComponentType<{ className?: string }>;
  iconClass: string;
}> = [
  { label: "WhatsApp", Icon: IconWhatsApp, iconClass: "text-emerald-400" },
  { label: "Telegram", Icon: IconTelegram, iconClass: "text-sky-400" },
  { label: "Google Sheets", Icon: IconSheets, iconClass: "" },
  { label: "Instagram", Icon: IconInstagram, iconClass: "text-pink-200" },
  { label: "Gmail", Icon: IconGmail, iconClass: "" },
] as const;

const featureCatalogBadges: Array<{ label: string; Icon: ComponentType<{ className?: string }> }> = [
  { label: "CRM и воронки", Icon: Funnel },
  { label: "Чаты", Icon: MessageCircle },
  { label: "Онлайн-запись", Icon: Calendar },
  { label: "Geo-трекер", Icon: MapPin },
  { label: "Задачи", Icon: CheckSquare },
  { label: "KPI", Icon: Target },
  { label: "Финансы", Icon: Wallet },
  { label: "Аналитика", Icon: BarChart3 },
  { label: "Аудит", Icon: BarChart3 },
  { label: "Роли и права", Icon: Users },
] as const;

type FlyIconEntry =
  | { kind: "integration"; label: string; Icon: ComponentType<{ className?: string }>; iconClass: string }
  | { kind: "feature"; label: string; Icon: ComponentType<{ className?: string }> };

const FLY_ICONS: FlyIconEntry[] = [
  ...integrationBadges.map((b) => ({ kind: "integration" as const, label: b.label, Icon: b.Icon, iconClass: b.iconClass })),
  ...featureCatalogBadges.map((b) => ({ kind: "feature" as const, label: b.label, Icon: b.Icon })),
];

type BillingCycle = "monthly" | "yearly";

const pricingPlans = [
  {
    id: "standard",
    name: "Стандарт",
    monthlyPrice: 450,
    users: "до 3 пользователей",
    extraUserPrice: 40,
    features: ["Kanban", "1 канал интеграции"],
  },
  {
    id: "standard_plus",
    name: "Стандарт+",
    monthlyPrice: 800,
    users: "до 5 пользователей",
    extraUserPrice: 40,
    features: ["Kanban", "1 канал интеграции", "KPI", "Задачи"],
  },
  {
    id: "premium",
    name: "Премиум",
    monthlyPrice: 1100,
    users: "до 6 пользователей",
    extraUserPrice: 30,
    features: ["Kanban", "2 канала интеграции", "KPI", "Задачи", "Аналитика"],
  },
  {
    id: "premium_plus",
    name: "Премиум+",
    monthlyPrice: 2000,
    users: "до 10 пользователей",
    extraUserPrice: 30,
    recommended: true,
    features: ["Kanban", "3 канала интеграции", "KPI", "Задачи", "Аналитика"],
  },
  {
    id: "vip",
    name: "VIP",
    monthlyPrice: 4500,
    users: "до 15 пользователей",
    extraUserPrice: 20,
    features: ["Kanban", "4 канала интеграции", "KPI", "Задачи", "Аналитика", "Финансы (без склада и ОПиУ)"],
  },
  {
    id: "vip_plus",
    name: "VIP+",
    monthlyPrice: 6000,
    users: "до 25 пользователей",
    extraUserPrice: 20,
    features: ["Kanban", "5 каналов интеграции", "KPI", "Задачи", "Аналитика", "Финансы (включая склад и ОПиУ)"],
  },
] as const;

function formatSomoni(value: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(value)} сомони`;
}

const faq = [
  {
    q: "Для чего нужна MetodiOne ERP?",
    a: "Чтобы объединить продажи, запись, коммуникации и финансы в одной системе и повысить управляемость команды.",
  },
  {
    q: "Кто может использовать систему?",
    a: "Владельцы, админы, менеджеры и эксперты. Для каждой роли доступен свой уровень прав и инструментов.",
  },
  {
    q: "Можно ли настроить ERP под мой бизнес?",
    a: "Да. Настраиваются воронки, стадии, источники лидов, роли, интеграции и отчеты под вашу структуру работы.",
  },
  {
    q: "Как быстро запустить?",
    a: "Базовый запуск занимает 1-2 дня: подключение каналов, настройка воронок, обучение команды и старт работы.",
  },
];

const integrationBadgeClass =
  "inline-flex w-[min(100%,300px)] min-h-9 shrink-0 items-center justify-center rounded-full border border-sky-300/35 bg-sky-500/10 px-3 py-1 text-center text-xs font-semibold uppercase tracking-[0.14em] text-sky-100 shadow-sm shadow-sky-900/30";

const catalogBadgeClass =
  "inline-flex w-[min(100%,300px)] min-h-9 shrink-0 items-center justify-center rounded-full border border-fuchsia-300/40 bg-gradient-to-r from-fuchsia-500/20 to-indigo-500/20 px-3 py-1 text-center text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-100 shadow-sm shadow-fuchsia-900/30";

export function LandingPage() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [openFaq, setOpenFaq] = useState<number>(0);
  const [demoOpen, setDemoOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<(typeof platformTabs)[number]["id"]>("crm");
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const heroRef = useRef<HTMLElement | null>(null);
  const heroCardRef = useRef<HTMLDivElement | null>(null);
  /** Заголовок + лид — орбита иконок в покое */
  const heroCopyRef = useRef<HTMLDivElement | null>(null);
  const m1AnchorRef = useRef<HTMLDivElement | null>(null);
  const integrationsCardRef = useRef<HTMLDivElement | null>(null);
  const slotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [dockProgress, setDockProgress] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const activePlatform = platformTabs.find((item) => item.id === activeTab) ?? platformTabs[0];

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMq = () => setReduceMotion(mq.matches);
    syncMq();
    mq.addEventListener("change", syncMq);
    return () => mq.removeEventListener("change", syncMq);
  }, []);

  useEffect(() => {
    const computeRaw = (): number => {
      if (reduceMotion) return 1;
      const card = integrationsCardRef.current;
      if (!card) return 0;
      const vh = window.innerHeight || 1;
      const sy = window.scrollY || document.documentElement.scrollTop || 0;
      const heroRect = heroRef.current?.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const heroTopAbs = (heroRect?.top ?? 0) + sy;
      const cardTopAbs = cardRect.top + sy;
      const start = Math.max(0, heroTopAbs + 8);
      const end = Math.max(start + 1, cardTopAbs - vh * 0.56);
      return clamp01((sy - start) / (end - start));
    };

    let raf = 0;
    const tick = () => {
      raf = 0;
      setDockProgress(computeRaw());
    };
    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(tick);
    };

    tick();
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule);
    const intCard = integrationsCardRef.current;
    if (intCard) ro.observe(intCard);
    const hero = heroRef.current;
    const heroCard = heroCardRef.current;
    const heroCopy = heroCopyRef.current;
    if (hero) ro.observe(hero);
    if (heroCard) ro.observe(heroCard);
    if (heroCopy) ro.observe(heroCopy);

    return () => {
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      ro.disconnect();
      window.cancelAnimationFrame(raf);
    };
  }, [reduceMotion]);

  const easedDock = easeInOutQuint(dockProgress);
  const dockHandoff = 0.992;
  const showFlyLayer = !reduceMotion && dockProgress < dockHandoff;
  const showSlotIcons = reduceMotion || dockProgress >= dockHandoff;

  const flyPositions = (): Array<{ left: number; top: number; spin: number; scale: number }> => {
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const half = FLY_ICON_BOX / 2;
    const n = FLY_ICONS.length;
    const raw = heroCopyRef.current?.getBoundingClientRect();
    const copy =
      raw && raw.width > 8 && raw.height > 8
        ? raw
        : new DOMRect((vw - Math.min(720, vw * 0.9)) / 2, vh * 0.2, Math.min(720, vw * 0.9), Math.min(320, vh * 0.3));

    return FLY_ICONS.map((_, i) => {
      const { left: orbitLeft, top: orbitTop } = orbitTopLeftAroundCopy(copy, i, n, half);
      const spin = (((i * 23) % 62) - 31) * (1 - easedDock);

      const slot = slotRefs.current[i];
      let endX = orbitLeft;
      let endY = orbitTop;
      if (slot) {
        const sr = slot.getBoundingClientRect();
        endX = sr.left + sr.width / 2 - half;
        endY = sr.top + sr.height / 2 - half;
      }
      const left = orbitLeft + (endX - orbitLeft) * easedDock;
      const top = orbitTop + (endY - orbitTop) * easedDock;
      const scale =
        FLY_SCATTER_SCALE_MAX + (FLY_SCATTER_SCALE_MIN - FLY_SCATTER_SCALE_MAX) * easedDock;
      return { left, top, spin, scale };
    });
  };

  const flyPos = showFlyLayer ? flyPositions() : [];

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      const res = await apiFetch<{ ok?: boolean; message?: string }>("/api/system/demo-request", {
        method: "POST",
        body: JSON.stringify({
          full_name: fullName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          message: message.trim() || null,
        }),
      });
      toast.success(
        typeof res?.message === "string" && res.message
          ? res.message
          : "Проверьте почту: мы отправили логин и пароль для входа в демо.",
      );
      setFullName("");
      setPhone("");
      setEmail("");
      setMessage("");
      setDemoOpen(false);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Ошибка отправки заявки";
      toast.error(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen app-shell-bg text-[var(--mo-text)]">
      <header className="sticky top-0 z-20 border-b border-[var(--mo-border)] bg-[var(--mo-surface-elevated)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-[#8c6d31] bg-[#A38A53] px-2 py-1 text-xs font-bold text-white">
              M1
            </div>
            <span className="font-display text-sm font-semibold text-[#9e844d] sm:text-base">MetodiOne ERP</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-[#5c6b7a] md:flex">
            <a href="#features" className="transition hover:text-[#2f5f85]">
              Возможности
            </a>
            <a href="#solutions" className="transition hover:text-[#2f5f85]">
              Для кого
            </a>
            <a href="#pricing" className="transition hover:text-[#2f5f85]">
              Тарифы
            </a>
            <a href="#screens" className="transition hover:text-[#2f5f85]">
              Скриншоты
            </a>
            <a href="#faq" className="transition hover:text-[#2f5f85]">
              FAQ
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setDemoOpen(true)} className="btn-primary">
              Получить демо
            </button>
            <a href="/login" className="btn-secondary">
              Вход
            </a>
          </div>
        </div>
      </header>

      <section ref={heroRef} className="mx-auto max-w-6xl px-4 pb-10 pt-10 sm:px-6 lg:px-8">
        <div
          ref={heroCardRef}
          className="glass-card relative z-[5] mx-auto max-w-4xl overflow-visible p-8 text-center shadow-md sm:p-10"
        >
          <div className="relative z-20 mx-auto flex min-h-[min(58vw,440px)] max-w-3xl flex-col items-center px-2 sm:min-h-[400px]">
            <div
              ref={m1AnchorRef}
              className="relative z-10 flex min-h-[52px] w-full flex-col items-center justify-center py-2"
            >
              <div className="rounded-lg border border-[#8c6d31] bg-[#A38A53] px-3 py-1.5 font-display text-lg font-bold tracking-tight text-white shadow-sm sm:px-4 sm:py-2 sm:text-xl">
                M1
              </div>
            </div>
            {showFlyLayer ? (
              <div className="pointer-events-none fixed inset-0 z-[14]" aria-hidden>
                {FLY_ICONS.map((entry, i) => {
                  const pos = flyPos[i];
                  if (!pos) return null;
                  const Icon = entry.Icon;
                  const box =
                    entry.kind === "feature"
                      ? "border-fuchsia-300/40 bg-gradient-to-br from-fuchsia-500/25 to-indigo-600/20 text-fuchsia-100 shadow-fuchsia-900/20"
                      : "border-[var(--mo-border)] bg-white text-[var(--mo-text)] shadow-[var(--mo-shadow-luxury)]";
                  return (
                    <div
                      key={`fly-${entry.label}-${i}`}
                      className={[
                        "fixed flex items-center justify-center rounded-xl border shadow-lg",
                        box,
                      ].join(" ")}
                      style={{
                        left: pos.left,
                        top: pos.top,
                        width: FLY_ICON_BOX,
                        height: FLY_ICON_BOX,
                        transform: `rotate(${pos.spin}deg) scale(${pos.scale})`,
                      }}
                    >
                      <Icon
                        className={
                          entry.kind === "integration"
                            ? ["h-7 w-7", entry.iconClass || "text-[var(--mo-text)]"].join(" ")
                            : "h-7 w-7 text-fuchsia-100"
                        }
                      />
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div ref={heroCopyRef} className="relative z-30 flex w-full max-w-3xl flex-col items-center">
              <h1 className="font-display mt-8 max-w-4xl text-4xl font-semibold leading-tight text-[#9e844d] sm:text-6xl">
                MetodiOne помогает бизнесу работать быстрее и прозрачнее
              </h1>
              <p className="relative z-10 mt-5 max-w-3xl text-base mo-muted sm:text-lg">
                Вместо десятка сервисов — один рабочий контур: CRM, чаты, онлайн-запись, KPI, задачи и финансовый контроль.
                Руководитель видит реальную ситуацию по команде и выручке в режиме реального времени.
              </p>
            </div>
            <div className="relative z-30 mt-7 grid w-full max-w-3xl gap-3 text-left text-sm text-[var(--mo-text)] sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-300/20 bg-emerald-500/10 px-4 py-3">
                Рост скорости ответа и меньше потерь лидов
              </div>
              <div className="rounded-xl border border-sky-300/20 bg-sky-500/10 px-4 py-3">
                Контроль планов продаж по каждому менеджеру
              </div>
              <div className="rounded-xl border border-fuchsia-300/20 bg-fuchsia-500/10 px-4 py-3">
                Автоматизация от заявки до финансовой отчетности
              </div>
              <div className="rounded-xl border border-indigo-300/20 bg-indigo-500/10 px-4 py-3">
                Подходит для клиник, сервиса, продаж и сетевого бизнеса
              </div>
            </div>
            <div className="relative z-30 mt-7 w-full max-w-3xl">
              <button
                type="button"
                onClick={() => setDemoOpen(true)}
                className="btn-primary w-full px-5 py-3 text-base"
              >
                Получить бесплатно за 5 минут
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
        <div ref={integrationsCardRef} className="rounded-2xl mo-section p-4">
          <div className="mb-3 flex justify-center px-1">
            <p className={integrationBadgeClass}>Интеграции</p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {integrationBadges.map((item, i) => (
              <div
                key={item.label}
                className="flex w-[100px] flex-col items-center gap-2 rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-3 text-center sm:w-[112px]"
              >
                <span
                  ref={(el) => {
                    slotRefs.current[i] = el;
                  }}
                  className={[
                    "inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 transition-opacity duration-300 [&>svg]:h-6 [&>svg]:w-6",
                    showSlotIcons ? "opacity-100" : "opacity-0",
                  ].join(" ")}
                  aria-hidden
                >
                  <item.Icon className={item.iconClass || "text-[var(--mo-text)]"} />
                </span>
                <span className="text-[11px] leading-tight mo-muted">{item.label}</span>
              </div>
            ))}
          </div>
          <div className="my-4 h-px bg-white/10" />
          <div className="mb-3 flex justify-center px-1">
            <p className={catalogBadgeClass}>Каталог Возможностей</p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {featureCatalogBadges.map((item, i) => (
              <div
                key={item.label}
                className="flex w-[100px] flex-col items-center gap-2 rounded-xl border border-fuchsia-300/20 bg-fuchsia-500/10 p-3 text-center sm:w-[112px]"
              >
                <span
                  ref={(el) => {
                    slotRefs.current[integrationBadges.length + i] = el;
                  }}
                  className={[
                    "inline-flex h-11 w-11 items-center justify-center rounded-xl bg-fuchsia-500/10 text-fuchsia-100 transition-opacity duration-300 [&>svg]:h-6 [&>svg]:w-6",
                    showSlotIcons ? "opacity-100" : "opacity-0",
                  ].join(" ")}
                  aria-hidden
                >
                  <item.Icon className="h-6 w-6" />
                </span>
                <span className="text-[11px] leading-tight text-[var(--mo-text)]">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="solutions" className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          {targetGroups.map((item) => (
            <article key={item.title} className="flex h-full flex-col rounded-2xl mo-section p-5 shadow-lg shadow-[var(--mo-shadow-luxury)]">
              <h3 className="text-xl font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed mo-muted">{item.text}</p>
              <button
                type="button"
                onClick={() => setDemoOpen(true)}
                className="btn-primary mt-4 w-full text-sm"
              >
                Получить бесплатно
              </button>
            </article>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
        <div className="rounded-3xl mo-section p-6 shadow-lg shadow-[var(--mo-shadow-luxury)] sm:p-8">
          <h2 className="text-center text-3xl font-semibold sm:text-4xl">Возможности MetodiOne</h2>
          <div className="mt-5 flex flex-wrap gap-2">
            {platformTabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={[
                  "rounded-xl border px-3 py-2 text-sm transition",
                  activeTab === item.id
                    ? "border-[#d4af37] bg-[#f7f2e8] text-[var(--mo-text)] shadow-[var(--mo-shadow-luxury)]"
                    : "border-[var(--mo-border-strong)] bg-[var(--mo-surface)] mo-muted hover:border-[#d4af37]/40 hover:text-[var(--mo-text)]",
                ].join(" ")}
              >
                {item.title}
              </button>
            ))}
          </div>
          <div className="mt-6 rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-5">
            <h3 className="lux-subheading text-xl">{activePlatform.title}</h3>
            <p className="mt-2 text-sm mo-muted">{activePlatform.lead}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {activePlatform.bullets.map((item) => (
                <div key={item} className="rounded-xl mo-section px-4 py-3 text-sm text-[var(--mo-text)]">
                  {item}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setDemoOpen(true)}
              className="btn-primary mt-5 w-full text-sm sm:w-auto"
            >
              Получить бесплатно
            </button>
          </div>
        </div>
      </section>

      <section id="screens" className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
        <h2 className="mb-2 text-center text-3xl font-semibold sm:text-4xl">Интерфейс в работе</h2>
        <p className="mb-6 text-center text-sm mo-muted">
          Реальные экраны MetodiOne: CRM-доска, чат, KPI, финансы, задачи, geo-трекер, онлайн-запись и интеграции.
        </p>
        <div className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-2">
          {shots.map((item, idx) => (
            <article
              key={`${item.src}-${item.title}-${idx}`}
              className="w-[88%] shrink-0 snap-start overflow-hidden rounded-2xl mo-section shadow-lg shadow-[var(--mo-shadow-luxury)] sm:w-[70%] lg:w-[48%]"
            >
              <img src={item.src} alt={item.title} className="h-auto w-full object-cover" loading="lazy" />
              <div className="border-t border-[var(--mo-border)] px-4 py-3 text-sm text-[var(--mo-text)]">{item.title}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
        <div className="mo-section rounded-3xl bg-gradient-to-r from-[#f7f2e8] via-white to-[var(--mo-surface)] p-7">
          <h2 className="text-center text-3xl font-semibold sm:text-4xl">Запуск за короткий цикл</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#9e844d]">Этап 1</p>
              <h3 className="mt-2 text-lg font-semibold">Диагностика процесса</h3>
              <p className="mt-2 text-sm mo-muted">Фиксируем текущую воронку, роли, каналы и точки потерь.</p>
            </div>
            <div className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#9e844d]">Этап 2</p>
              <h3 className="mt-2 text-lg font-semibold">Настройка системы</h3>
              <p className="mt-2 text-sm mo-muted">Подключаем интеграции, стадии, KPI и онлайн-запись под ваш процесс.</p>
            </div>
            <div className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#9e844d]">Этап 3</p>
              <h3 className="mt-2 text-lg font-semibold">Запуск команды</h3>
              <p className="mt-2 text-sm mo-muted">Обучаем сотрудников, запускаем контроль и стабилизируем метрики.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
        <div className="rounded-3xl mo-section p-6 shadow-lg shadow-[var(--mo-shadow-luxury)] sm:p-8">
          <div className="mb-5 flex justify-center">
            <div className="mo-tabs inline-flex rounded-2xl p-1.5 text-sm">
              <button
                type="button"
                onClick={() => setBillingCycle("monthly")}
                className={billingCycle === "monthly" ? "active" : ""}
              >
                Ежемесячная
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle("yearly")}
                className={billingCycle === "yearly" ? "active" : ""}
              >
                Годовая (−15%)
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4 text-center">
            <div>
              <h2 className="text-3xl font-semibold sm:text-4xl">Тарифы</h2>
              <p className="mt-2 text-sm mo-muted">
                Выберите формат оплаты: помесячно или на год со скидкой 15%.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pricingPlans.map((plan) => {
              const isYearly = billingCycle === "yearly";
              const monthlyDisplay = isYearly ? Math.round(plan.monthlyPrice * 0.85) : plan.monthlyPrice;
              const yearlyTotal = Math.round(plan.monthlyPrice * 12 * 0.85);
              return (
                <article
                  key={plan.id}
                  className={[
                    "relative flex h-full flex-col rounded-2xl border p-5 shadow-lg shadow-[var(--mo-shadow-luxury)] transition duration-300",
                    "hover:z-10 hover:-translate-y-1.5 hover:scale-[1.02] hover:shadow-2xl hover:shadow-fuchsia-900/35",
                    plan.recommended
                      ? "border-[#d4af37] bg-[#f7f2e8] ring-1 ring-[#d4af37]/35"
                      : "border-[var(--mo-border)] bg-[var(--mo-surface)]",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="lux-subheading text-xl">{plan.name}</h3>
                    {plan.recommended && (
                      <span className="mo-badge text-[11px]">
                        Рекомендуем
                      </span>
                    )}
                  </div>
                  <p className="font-display mt-3 text-3xl font-bold text-[var(--mo-text)]">{formatSomoni(monthlyDisplay)}</p>
                  <p className="mt-1 text-xs lux-caption">
                    {isYearly ? "в месяц при оплате за год" : "в месяц"}
                  </p>
                  {isYearly && <p className="mt-1 text-xs text-[#0f4c3a]">Итого за год: {formatSomoni(yearlyTotal)}</p>}
                  <p className="mt-4 text-sm text-[var(--mo-text)]">{plan.users}</p>
                  <p className="mt-1 text-xs lux-caption">
                    Доп. пользователь: +{formatSomoni(plan.extraUserPrice)} / мес
                  </p>
                  <ul className="mt-4 space-y-1.5 text-sm text-[var(--mo-text)]">
                    {plan.features.map((feature) => (
                      <li key={feature}>• {feature}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => setDemoOpen(true)}
                    className="btn-primary mt-auto w-full text-sm"
                  >
                    Выбрать тариф
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-4xl px-4 pb-16 sm:px-6 lg:px-8">
        <h2 className="mb-6 text-center text-3xl font-semibold sm:text-4xl">Часто задаваемые вопросы</h2>
        <div className="space-y-3">
          {faq.map((item, idx) => {
            const open = openFaq === idx;
            return (
              <article key={item.q} className="rounded-2xl mo-section shadow-lg shadow-[var(--mo-shadow-luxury)]">
                <button
                  type="button"
                  onClick={() => setOpenFaq(open ? -1 : idx)}
                  className="flex w-full items-center justify-between px-5 py-4 text-left"
                >
                  <span className="text-sm font-semibold sm:text-base">{item.q}</span>
                  <span className="text-xl leading-none text-[#9e844d]">{open ? "−" : "+"}</span>
                </button>
                {open && <p className="border-t border-[var(--mo-border)] px-5 py-4 text-sm leading-relaxed mo-muted">{item.a}</p>}
              </article>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-fuchsia-300/20 bg-white p-8 text-center shadow-2xl shadow-[var(--mo-shadow-luxury)] sm:p-10">
          <h2 className="font-display text-3xl font-semibold text-[#9e844d] sm:text-4xl">Готовы собрать всю операционку в одной ERP?</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm mo-muted sm:text-base">
            Покажем, как именно MetodiOne ляжет на ваш процесс продаж и обслуживания клиентов — без лишних модулей и
            сложного внедрения.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setDemoOpen(true)}
              className="btn-primary px-6 py-3 text-sm"
            >
              Получить демо
            </button>
            <a
              href="/login"
              className="btn-secondary px-6 py-3 text-sm"
            >
              Перейти в систему
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-[var(--mo-border)] bg-white py-10 text-[var(--mo-text)]">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:grid-cols-2 sm:px-6 lg:px-8">
          <div>
            <h3 className="text-lg font-semibold">MetodiOne ERP</h3>
            <p className="mt-2 text-sm lux-caption">
              ERP-платформа для продаж, коммуникаций, KPI и финансового контроля.
            </p>
          </div>
          <div className="text-sm sm:text-right">
            <p>Email: metoditj@gmail.com</p>
            <p className="mt-1 lux-caption">© {new Date().getFullYear()} MetodiOne. Все права защищены.</p>
          </div>
        </div>
      </footer>

      {demoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2c2520]/45 p-4">
          <div className="crm-modal-panel w-full max-w-xl p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="lux-heading-page text-2xl">Запросить демо</h2>
                <p className="mt-1 text-sm mo-muted">Оставьте контакты, и мы отправим вам персональную демонстрацию продукта.</p>
              </div>
              <button
                type="button"
                onClick={() => setDemoOpen(false)}
                className="rounded-lg border border-[var(--mo-border)] px-3 py-1 text-sm text-[var(--mo-text)] transition hover:bg-white/10"
              >
                Закрыть
              </button>
            </div>
            <form onSubmit={onSubmit} className="space-y-3">
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                minLength={2}
                placeholder="ФИО"
                className="w-full rounded-xl border border-[var(--mo-border-strong)] bg-[var(--mo-surface)] px-4 py-2.5 text-sm text-[var(--mo-text)] outline-none ring-fuchsia-400/40 transition focus:ring-2"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                minLength={7}
                placeholder="Телефон"
                className="w-full rounded-xl border border-[var(--mo-border-strong)] bg-[var(--mo-surface)] px-4 py-2.5 text-sm text-[var(--mo-text)] outline-none ring-fuchsia-400/40 transition focus:ring-2"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="Email"
                className="w-full rounded-xl border border-[var(--mo-border-strong)] bg-[var(--mo-surface)] px-4 py-2.5 text-sm text-[var(--mo-text)] outline-none ring-fuchsia-400/40 transition focus:ring-2"
              />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder="Комментарий (необязательно)"
                className="w-full resize-none rounded-xl border border-[var(--mo-border-strong)] bg-[var(--mo-surface)] px-4 py-2.5 text-sm text-[var(--mo-text)] outline-none ring-fuchsia-400/40 transition focus:ring-2"
              />
              <button
                type="submit"
                disabled={sending}
                className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-70"
              >
                {sending ? "Отправка..." : "Отправить заявку"}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
