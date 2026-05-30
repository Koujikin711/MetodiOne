import { Link } from "react-router-dom";

import type { Pipeline } from "@/lib/types";

type ViewMode = "board" | "list";

type Props = {
  isCompanyAdmin: boolean;
  pipelineSettingsOpen: boolean;
  onTogglePipelineSettings: () => void;
  onCreateLead: () => void;
  onImport: () => void;
  pipelines: Pipeline[] | undefined;
  pipelineId: number | null;
  onSelectPipeline: (id: number) => void;
  crmView: ViewMode;
  onSetView: (view: ViewMode) => void;
  boardSearchInput: string;
  onBoardSearchChange: (value: string) => void;
  showBoardSearch: boolean;
  showOnboardingBanner?: boolean;
};

export function CrmBusinessToolbar({
  isCompanyAdmin,
  pipelineSettingsOpen,
  onTogglePipelineSettings,
  onCreateLead,
  onImport,
  pipelines,
  pipelineId,
  onSelectPipeline,
  crmView,
  onSetView,
  boardSearchInput,
  onBoardSearchChange,
  showBoardSearch,
  showOnboardingBanner = false,
}: Props) {
  const activePipeline = pipelines?.find((p) => p.id === pipelineId);

  return (
    <header className="space-y-4">
      {showOnboardingBanner ? (
        <div className="executive-banner flex flex-wrap items-center justify-center gap-3">
          <span>Первый день в CRM: пройдите короткий мастер настройки воронки и команды.</span>
          <Link
            to="/onboarding"
            className="rounded-lg border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/18"
          >
            Открыть мастер
          </Link>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="crm-brand-title">MetodiOne</h1>
          <p className="mt-1 text-sm font-medium text-[#7A7265]">CRM · управление воронкой и лидами</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isCompanyAdmin ? (
            <button type="button" onClick={onTogglePipelineSettings} className="crm-pill-btn">
              {pipelineSettingsOpen ? "Скрыть настройки воронки" : "Настройки воронки"}
            </button>
          ) : null}
          <button type="button" onClick={onCreateLead} className="crm-pill-btn">
            + Лид
          </button>
          <button type="button" onClick={onImport} className="crm-pill-btn">
            Импорт CSV
          </button>
        </div>
      </div>

      {pipelines && pipelines.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[#7A7265]">Воронка:</span>
            <span className="text-sm font-semibold text-[#2C2520]" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
              {activePipeline?.name ?? "—"}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {pipelines.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelectPipeline(p.id)}
                  className={pipelineId === p.id ? "crm-pill-btn crm-pill-btn--active" : "crm-pill-btn"}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[#7A7265]">Вид</span>
            <div className="crm-view-switch" role="group" aria-label="Вид CRM">
              <button type="button" data-active={crmView === "board"} onClick={() => onSetView("board")}>
                Доска
              </button>
              <button type="button" data-active={crmView === "list"} onClick={() => onSetView("list")}>
                Список
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showBoardSearch ? (
        <div className="crm-search-wrap">
          <label className="sr-only" htmlFor="crm-board-search">
            Поиск на доске
          </label>
          <input
            id="crm-board-search"
            name="board_search"
            value={boardSearchInput}
            onChange={(e) => onBoardSearchChange(e.target.value)}
            placeholder="Поиск: имя, телефон, email или № лида…"
            className="crm-search-input"
          />
          <p className="mt-2 text-center text-[11px] text-[#A89880]">
            Фильтр только на экране — перетаскивание и данные на сервере не меняются
          </p>
        </div>
      ) : null}
    </header>
  );
}
