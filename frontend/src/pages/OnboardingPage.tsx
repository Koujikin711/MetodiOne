import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { OwnerTerminateEmployeesModal } from "@/components/OwnerTerminateEmployeesModal";
import { getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { setOnboardingDone } from "@/lib/onboarding";

const steps = [
  { title: "Воронка и лиды", desc: "Канбан, стадии и карточки лидов.", to: "/crm", done: "Открыть CRM" },
  { title: "Онлайн-запись", desc: "Направления, специалисты и слоты в календаре.", to: "/booking", done: "К записи" },
  { title: "Интеграции каналов", desc: "WhatsApp, Google Sheets и вебхуки.", to: "/integrations", done: "К интеграциям" },
  { title: "Финансы (по желанию)", desc: "План счетов, журнал, отчёты и склад.", to: "/finance", done: "К финансам" },
];

export function OnboardingPage() {
  const navigate = useNavigate();
  const [terminateOpen, setTerminateOpen] = useState(false);
  const isOwner = decodeRoleFromToken(getStoredToken()) === "owner";

  function finish() {
    setOnboardingDone();
    navigate("/app", { replace: true });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-semibold text-white">Мастер первого дня</h1>
        <p className="mt-2 text-sm text-slate-400">
          Пройдите шаги в удобном порядке. Позже мастер можно снова открыть по ссылке{" "}
          <span className="text-slate-300">/onboarding</span> — отметка «готово» сбрасывается только кнопкой ниже.
        </p>
      </div>

      {isOwner ? (
        <div className="rounded-2xl border border-slate-600/50 bg-slate-800/35 px-4 py-3">
          <p className="text-sm text-slate-300">
            Нужно сразу закрыть доступ сотрудникам? Выберите одного или нескольких — вход будет заблокирован.
          </p>
          <button
            type="button"
            onClick={() => setTerminateOpen(true)}
            className="mt-3 rounded-xl border border-red-500/40 bg-red-950/35 px-4 py-2 text-sm font-medium text-red-100 hover:bg-red-950/50"
          >
            Уволить
          </button>
        </div>
      ) : null}

      <ol className="space-y-4">
        {steps.map((s, i) => (
          <li
            key={s.to}
            className="flex flex-col gap-2 rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <div className="text-xs font-medium text-purple-300">Шаг {i + 1}</div>
              <div className="text-lg font-medium text-white">{s.title}</div>
              <p className="mt-1 text-sm text-slate-400">{s.desc}</p>
            </div>
            <Link
              to={s.to}
              className="shrink-0 rounded-xl bg-white/10 px-4 py-2 text-center text-sm font-medium text-white ring-1 ring-white/15 hover:bg-white/15"
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
          className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/25"
        >
          Готово, больше не показывать баннер
        </button>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-xl border border-slate-600/60 px-5 py-2.5 text-sm text-slate-200 hover:bg-white/5"
        >
          Назад
        </button>
      </div>

      <OwnerTerminateEmployeesModal open={terminateOpen} onClose={() => setTerminateOpen(false)} />
    </div>
  );
}
