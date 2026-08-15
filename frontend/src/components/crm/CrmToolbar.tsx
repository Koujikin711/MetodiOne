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

export function CrmToolbar({
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
  return (
    <header className="crm-toolbar">
      {showOnboardingBanner ? (
        <div className="executive-banner flex flex-wrap items-center justify-center gap-3">
          <span>Первый день в CRM: пройдите короткий мастер настройки воронки и команды.</span>
          <Link
            to="/onboarding"
            className="rounded-lg border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold text-[var(--mo-text)] hover:bg-white/18"
          >
            Открыть мастер
          </Link>
        </div>
      ) : null}

      <div className="crm-toolbar__head">
        <div className="crm-toolbar__brand">
          <h1 className="crm-brand-title">MetodiOne</h1>
          <p className="crm-toolbar__subtitle">CRM · управление воронкой и лидами</p>
        </div>
        <div className="crm-toolbar__actions">
          {isCompanyAdmin ? (
            <button type="button" onClick={onTogglePipelineSettings} className="crm-pill-btn">
              {pipelineSettingsOpen ? "Скрыть настройки" : "Настройки воронки"}
            </button>
          ) : null}
          <button type="button" onClick={onCreateLead} className="crm-pill-btn crm-pill-btn--primary">
            + Лид
          </button>
          <button type="button" onClick={onImport} className="crm-pill-btn">
            Импорт CSV
          </button>
        </div>
      </div>

      {pipelines && pipelines.length > 0 ? (
        <div className="crm-toolbar__bar">
          <div className="crm-toolbar__funnels">
            <span className="crm-toolbar__label">Воронка</span>
            <div className="crm-toolbar__pills" role="group" aria-label="Воронка">
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

          <div className="crm-toolbar__view">
            <span className="crm-toolbar__label">Вид</span>
            <div className="crm-view-switch" role="group" aria-label="Вид CRM">
              <button type="button" data-active={crmView === "board"} onClick={() => onSetView("board")}>
                Доска
              </button>
              <button type="button" data-active={crmView === "list"} onClick={() => onSetView("list")}>
                Список
              </button>
            </div>
          </div>

          {showBoardSearch ? (
            <div className="crm-toolbar__search">
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
            </div>
          ) : null}
        </div>
      ) : null}

      {showBoardSearch ? (
        <p className="crm-toolbar__hint">Фильтр только на экране — перетаскивание и данные на сервере не меняются</p>
      ) : null}
    </header>
  );
}
