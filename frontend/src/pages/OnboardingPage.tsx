import { Link, useNavigate } from "react-router-dom";

import { getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { setOnboardingDone } from "@/lib/onboarding";

const steps = [
  { title: "Воронка и лиды", desc: "Канбан, стадии и карточки лидов.", to: "/crm", done: "Открыть CRM" },
  { title: "Онлайн-запись", desc: "Направления, специалисты и слоты в календаре.", to: "/booking", done: "К записи" },
  { title: "Интеграции каналов", desc: "WhatsApp, Google Sheets и вебхуки.", to: "/integrations", done: "К интеграциям" },
];

export function OnboardingPage() {
  const navigate = useNavigate();
  const isOwner = decodeRoleFromToken(getStoredToken()) === "owner";

  function finish() {
    setOnboardingDone();
    navigate("/app", { replace: true });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-12">
      <div>
        <h1 className="lux-heading-page text-2xl">Мастер первого дня</h1>
        <p className="mt-2 text-sm lux-caption">
          Пройдите шаги в удобном порядке. Позже мастер можно снова открыть по ссылке{" "}
          <span className="mo-muted">/onboarding</span> — отметка «готово» сбрасывается только кнопкой ниже.
        </p>
      </div>

      {isOwner ? (
        <div className="rounded-2xl border border-[var(--mo-border-strong)]/50 bg-[var(--mo-accent-soft)]/35 px-4 py-3">
          <p className="text-sm mo-muted">
            Управление доступом сотрудников — в разделе «Сотрудники»: приглашения, роли и отключение учётных записей.
          </p>
        </div>
      ) : null}

      <ol className="space-y-4">
        {steps.map((s, i) => (
          <li
            key={s.to}
            className="flex flex-col gap-2 rounded-2xl border border-[var(--mo-border)] bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <div className="text-xs font-medium text-[var(--mo-accent-hover)]">Шаг {i + 1}</div>
              <div className="lux-subheading">{s.title}</div>
              <p className="mt-1 text-sm lux-caption">{s.desc}</p>
            </div>
            <Link
              to={s.to}
              className="shrink-0 rounded-xl bg-white/10 px-4 py-2 text-center text-sm font-medium text-[var(--mo-text)] ring-1 ring-white/15 hover:bg-white/15"
            >
              {s.done}
            </Link>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={finish}
          className="btn-primary"
        >
          Готово, больше не показывать баннер
        </button>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-xl border border-[var(--mo-border-strong)]/60 px-5 py-2.5 text-sm text-[var(--mo-text)] hover:bg-white/5"
        >
          Назад
        </button>
      </div>
    </div>
  );
}
