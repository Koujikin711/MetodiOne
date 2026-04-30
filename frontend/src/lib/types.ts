export type UserRole = "super_owner" | "owner" | "admin" | "manager" | "expert" | "finance_analyst";

export interface User {
  id: number;
  email: string;
  role: UserRole;
}

export interface PipelineStage {
  id: number;
  name: string;
  order: number;
  color: string;
  pipeline_id?: number | null;
}

export interface Pipeline {
  id: number;
  name: string;
  type: string | null;
  lead_assignment_mode?: string;
  expert_user_id?: number | null;
  intake_manager_user_id?: number | null;
}

export interface LeadSource {
  id: number;
  name: string;
  is_active: boolean;
}

export interface Integration {
  id: number;
  name: string;
  provider: string;
  is_active: boolean;
  pipeline_id: number;
  stage_id: number;
  /** Кнопка «Закрыть сделку» у менеджеров на карточке лида этой воронки */
  manager_close_deal_enabled?: boolean;
  /** Без api_token; токен только на сервере */
  config: Record<string, unknown> | null;
  has_api_token?: boolean;
  /** Подсказка после создания/сохранения (например автоподключение WhatsApp) */
  setup_note?: string | null;
}

export interface ChatThread {
  id: number;
  lead_id: number | null;
  lead_name: string | null;
  manager_id?: number | null;
  manager_name?: string | null;
  provider: string;
  external_chat_id: string | null;
  title: string | null;
  pipeline_id: number | null;
  updated_at: string;
  /** Входящие от клиента, не просмотренные в этом диалоге */
  unread_count?: number;
  /** Время первого сообщения в диалоге (для подсветки «свежих») */
  first_message_at?: string | null;
  /** Направление последнего сообщения: in — от клиента, out — от нас */
  last_message_direction?: "in" | "out" | null;
}

export interface ChatMessage {
  id: number;
  thread_id: number;
  author_user_id: number | null;
  direction: "in" | "out";
  text: string;
  message_type?: string;
  media_url?: string | null;
  media_mime?: string | null;
  file_name?: string | null;
  delivery_status: string;
  created_at: string;
}

export interface Lead {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  status_id: number;
  stage_name: string | null;
  manager_id: number | null;
  manager_name?: string | null;
  refusal_reason?: string | null;
  protocol_file_attached?: boolean;
  protocol_requested?: boolean;
  protocol_confirmed?: boolean;
  protocol_deal_id?: number | null;
  paid_extras_amount?: unknown;
  show_close_deal_button?: boolean;
  created_at?: string | null;
}

export interface LeadImportErrorItem {
  row: number;
  message: string;
}

export interface LeadImportResponse {
  created: number;
  errors: LeadImportErrorItem[];
}

export interface LeadTablePage {
  items: Lead[];
  total: number;
  page: number;
  page_size: number;
}

export interface LeadAuditEvent {
  id: number;
  lead_id: number;
  action: string;
  details: string | null;
  user_id: number | null;
  user_name: string | null;
  created_at: string;
}

export interface SystemAuditEvent {
  id: number;
  entity_type: string;
  entity_id: number | null;
  action: string;
  details: string | null;
  user_id: number | null;
  user_name: string | null;
  created_at: string;
}

export type TaskStatus = "pending" | "in_progress" | "done" | "cancelled";

export interface Task {
  id: number;
  title: string;
  deadline: string | null;
  status: TaskStatus;
  assigned_to: number | null;
  assigned_to_name?: string | null;
  assigned_to_role?: UserRole | null;
  created_by_user_id?: number | null;
  created_by_name?: string | null;
  created_by_role?: UserRole | null;
  description: string | null;
  related_lead_id?: number | null;
  review_score?: number | null;
  review_comment?: string | null;
  review_by_user_id?: number | null;
  review_at?: string | null;
  is_locked?: boolean;
}

export interface TaskAssignee {
  id: number;
  full_name?: string | null;
  email: string;
  role: UserRole;
}

export interface TaskListResponse {
  items: Task[];
  total: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  must_change_password?: boolean;
}

/** Сводка платформы для super_owner (`GET /api/companies/dashboard`). */
export interface PlatformDashboardRead {
  companies_total: number;
  companies_active: number;
  companies_suspended: number;
  users_total: number;
  leads_total: number;
  pipelines_total: number;
  global_tariff_max_active_users: number;
  global_tariff_max_integrations: number;
  recent_audit_count: number;
  recent_background_failures: number;
}

/** Запись аудита super_owner (`GET /api/companies/audit-log`). */
export interface SuperOwnerAuditRead {
  id: number;
  actor_user_id: number;
  company_id: number | null;
  action: string;
  detail: string | null;
  created_at: string;
}

/** Компания в списке super_owner (включая переопределения тарифа). */
export interface SuperOwnerCompanyRead {
  id: number;
  name: string;
  contact_email?: string | null;
  is_active: boolean;
  users_count: number;
  leads_count: number;
  pipelines_count: number;
  tariff_plan_id?: number | null;
  tariff_plan_name?: string | null;
  tariff_max_active_users: number | null;
  tariff_max_integrations: number | null;
  billing_status?: string;
  trial_ends_at?: string | null;
  pending_tariff_plan_id?: number | null;
  pending_tariff_plan_name?: string | null;
  billing_discount_percent?: number | null;
  scheduled_tariff_plan_id?: number | null;
  scheduled_tariff_plan_name?: string | null;
  scheduled_tariff_effective_at?: string | null;
}

export interface TariffPlanRead {
  id: number;
  name: string;
  max_active_users: number;
  max_integrations: number;
  enabled_features: string[];
  warehouse_enabled?: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface BillingTariffChoice {
  id: number;
  name: string;
  max_active_users: number;
  max_integrations: number;
  warehouse_enabled: boolean;
}

export interface BillingCompositionLine {
  kind: string;
  key?: string;
  label: string;
  amount: string;
  quantity?: number;
  unit_amount?: string;
}

export interface BillingStatusRead {
  billing_status: string;
  trial_ends_at: string | null;
  pending_tariff_plan_id: number | null;
  pending_tariff_plan_name: string | null;
  current_tariff_plan_id: number | null;
  current_tariff_plan_name: string | null;
  plans: BillingTariffChoice[];
  billing_currency?: string | null;
  monthly_subtotal?: string | null;
  monthly_discount_percent?: string | null;
  monthly_discount_amount?: string | null;
  monthly_total?: string | null;
  composition?: BillingCompositionLine[] | null;
}

export interface TariffPricingTableRead {
  feature_prices: { feature_key: string; currency: string; monthly_amount: number }[];
  limit_prices: { limit_kind: string; currency: string; monthly_amount: number }[];
}

export interface PendingPaymentCompanyRead {
  id: number;
  name: string;
  contact_email?: string | null;
  billing_status: string;
  pending_tariff_plan_id: number | null;
  pending_tariff_plan_name: string | null;
  tariff_plan_id: number | null;
  tariff_plan_name: string | null;
}

export interface PlatformBillingSettingsRead {
  demo_trial_days: number;
}

export interface FeatureCatalogItem {
  key: string;
  label: string;
}

/** Текущий доступ по тарифу (`GET /api/system/tariff-access`). */
export interface TariffAccessRead {
  plan_id: number | null;
  plan_name: string | null;
  enabled_features: string[];
  feature_labels: Record<string, string>;
  upgrade_hints: Record<string, string[]>;
}

export interface HorecaShiftOverview {
  bookings_today: number;
  revenue_today: string;
  avg_check_today: string;
  open_tasks: number;
  low_stock_items: number;
  cogs_7d: string;
}

export interface HorecaAbcItem {
  item_name: string;
  revenue: string;
  share_pct: number;
  abc_class: "A" | "B" | "C" | string;
}

export interface HorecaFoodCostItem {
  product_id: number;
  product_name: string;
  quantity: string;
  avg_unit_cost: string;
  stock_value: string;
  share_pct: number;
  risk: "ok" | "low" | "out" | string;
}

export interface HorecaOverviewRead {
  generated_at: string;
  shift: HorecaShiftOverview;
  abc_menu: HorecaAbcItem[];
  food_cost_top: HorecaFoodCostItem[];
}

export interface HorecaMenuItem {
  id: number;
  name: string;
  sale_price: string;
  is_active: boolean;
}

export interface HorecaTechCardLine {
  product_id: number;
  product_name: string;
  qty_per_portion: string;
  avg_unit_cost: string;
  line_cost: string;
}

export interface HorecaTechCardRead {
  menu_item_id: number;
  menu_item_name: string;
  sale_price: string;
  recipe_cost: string;
  gross_per_portion: string;
  food_cost_pct: number;
  lines: HorecaTechCardLine[];
}

export interface HorecaFinanceItem {
  menu_item_name: string;
  qty: number;
  revenue: string;
  cogs: string;
  gross_profit: string;
  food_cost_pct: number;
  abc_class: string;
  unmapped: boolean;
}

export interface HorecaFinanceSummaryRead {
  date_from: string;
  date_to: string;
  revenue: string;
  cogs: string;
  gross_profit: string;
  gross_margin_pct: number;
  food_cost_pct: number;
  sales_count: number;
  mapped_sales_count: number;
  unmapped_sales_count: number;
  items: HorecaFinanceItem[];
}

export interface HorecaOrderBoardItem {
  id: number;
  stage: "new" | "in_work" | "ready" | "closed" | string;
  status: string;
  table_id: number | null;
  table_name: string | null;
  guest_name: string;
  item_name: string;
  start_at: string;
  end_at: string;
  paid_amount: string;
}

export interface HorecaTableStatus {
  table_id: number;
  table_name: string;
  table_number: number;
  is_busy: boolean;
  current_order_id: number | null;
  current_guest_name: string | null;
  current_item_name: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

export interface HorecaProductOption {
  id: number;
  name: string;
  unit: string;
  is_active: boolean;
}

export interface HorecaStockBalance {
  product_id: number;
  product_name: string;
  quantity: string;
  avg_unit_cost: string;
  stock_value: string;
  risk: "ok" | "low" | "out" | string;
}

export interface HorecaStockMovement {
  id: number;
  created_at: string;
  movement_type: string;
  product_id: number;
  product_name: string;
  qty_delta: string;
  unit_cost: string | null;
  memo: string | null;
}

export interface HorecaStockAlert {
  product_id: number;
  product_name: string;
  quantity: string;
  risk: "ok" | "low" | "out" | string;
}

export interface HorecaStockReportLine {
  product_id: number;
  product_name: string;
  issue_qty: string;
  issue_value: string;
}

export interface HorecaStockReportRead {
  date_from: string;
  date_to: string;
  total_issue_value: string;
  lines: HorecaStockReportLine[];
}

export interface HorecaPrepLine {
  menu_item_id: number;
  menu_item_name: string;
  portions_ready: string;
}

export interface HorecaSellableItem {
  menu_item_id: number;
  menu_item_name: string;
  max_from_stock: number | null;
  portions_prepared_today: string | null;
  sellable_portions: number | null;
}

export interface HorecaCapacityForecastRead {
  generated_at: string;
  tables_count: number;
  staff_horeca_count: number;
  avg_visit_minutes: number;
  turns_per_table_per_4h: number;
  estimated_max_covers_4h: number;
  notes: string;
}

export interface LeadStatusPatchResponse extends Lead {
  automation_task_created: boolean;
}

export interface PipelineFullAnalyticsItem {
  pipeline_id: number | null;
  pipeline_name: string;
  leads_count: number;
  processed_by_manager_count: number;
  received_amount: string;
  debt_amount: string;
}

export interface FullAnalyticsRead {
  total_leads: number;
  total_received_amount: string;
  total_debt_amount: string;
  by_pipeline: PipelineFullAnalyticsItem[];
}

export interface ManagerDetailedAnalyticsItem {
  manager_id: number | null;
  manager_name: string;
  leads_count: number;
  sold_amount: string;
  unpaid_amount: string;
}

export interface DetailedAnalyticsRead {
  total_leads: number;
  total_sold_amount: string;
  total_unpaid_amount: string;
  by_manager: ManagerDetailedAnalyticsItem[];
}

export interface StageConversionItem {
  stage_id: number;
  stage_name: string;
  order: number;
  leads_count: number;
  conversion_to_next_pct: number | null;
  avg_time_in_stage_hours: number | null;
}

export interface SourceAnalyticsItem {
  source: string;
  leads_count: number;
  sold_amount: string;
  paid_amount: string;
  unpaid_amount: string;
  lead_share_pct: number;
}

export interface LossReasonItem {
  reason: string;
  count: number;
  share_pct: number;
}

export interface ManagerPlanFactItem {
  manager_id: number | null;
  manager_name: string;
  plan_amount: string;
  fact_paid_amount: string;
  plan_completion_pct: number;
}

export interface AnalyticsAlertsRead {
  low_first_response: boolean;
  high_unpaid_share: boolean;
  low_stage_conversion: boolean;
  summary: string[];
}

export interface ExecutiveKpiRead {
  leads_total: number;
  won_leads: number;
  win_rate_pct: number;
  paid_amount: string;
  unpaid_amount: string;
  avg_first_response_minutes: number | null;
  avg_lead_cycle_hours: number | null;
}

export interface AnalyticsOverviewRead {
  period_start: string;
  period_end: string;
  executive: ExecutiveKpiRead;
  stage_conversion: StageConversionItem[];
  by_source: SourceAnalyticsItem[];
  loss_reasons: LossReasonItem[];
  manager_plan_fact: ManagerPlanFactItem[];
  alerts: AnalyticsAlertsRead;
}

export interface BookingDirection {
  id: number;
  name: string;
  duration_min: number;
  is_active: boolean;
  pipeline_id: number | null;
  pipeline_name?: string | null;
}

export interface BookingSpecialist {
  id: number;
  full_name: string;
  direction_id: number;
  direction_name: string | null;
  phone: string | null;
  /** Может отсутствовать у кэша до обновления API */
  specialization?: string | null;
  is_active: boolean;
  sort_order?: number;
  slot_duration_min?: number;
  work_start_hour?: number;
  work_end_hour?: number;
  /** 0=Пн … 6=Вс (как на бэкенде) */
  work_weekdays?: number[];
}

export interface BookingAppointment {
  id: number;
  lead_id: number | null;
  specialist_id: number;
  direction_id: number;
  patient_name: string;
  patient_phone: string;
  start_at: string;
  end_at: string;
  status: string;
  service_amount: number;
  paid_amount: number;
  responsible_manager_id: number | null;
  service_title?: string | null;
  direction_name: string | null;
  specialist_name: string | null;
  comment: string | null;
  /** Оплата/удаление в журнале (владелец или админ воронки по лиду) */
  can_manage_journal?: boolean;
  /** Когда клиенту отправили уведомление о записи */
  notification_sent_at?: string | null;
  /** Когда клиент ответил на уведомление */
  notification_replied_at?: string | null;
}

export interface BookingPatientVisit {
  appointment_id: number;
  start_at: string;
  specialist_name: string | null;
  status: string;
  service_title: string | null;
  service_amount: number;
  paid_amount: number;
}

export interface BookingPatientHistoryItem {
  patient_name: string;
  patient_phone: string;
  total_visits: number;
  first_visit_at: string | null;
  last_visit_at: string | null;
  visits: BookingPatientVisit[];
}

export interface AttendanceGeofence {
  id: number;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radius_m: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AttendanceShift {
  id: number;
  user_id: number;
  geofence_id: number | null;
  start_at: string;
  end_at: string | null;
  started_in_geofence: boolean;
  ended_in_geofence: boolean | null;
  suspicious: boolean;
  suspicious_reason: string | null;
  duration_sec: number | null;
}

export interface AttendanceMyStatus {
  active_shift: AttendanceShift | null;
  today_total_sec: number;
}

export interface AttendanceEmployeeSummary {
  user_id: number;
  full_name: string | null;
  email: string;
  total_sec: number;
  shifts_count: number;
  suspicious_events: number;
}

export interface AttendanceReport {
  date_from: string;
  date_to: string;
  employees: AttendanceEmployeeSummary[];
}

export interface ExpertBookingItem {
  specialist_id: number;
  specialist_name: string;
  specialization: string | null;
  patients_booked: number;
  patients_arrived: number;
}

export interface PipelineExpertReport {
  pipeline_id: number;
  pipeline_name: string;
  patients_booked: number;
  patients_arrived: number;
  experts: ExpertBookingItem[];
}

export interface ExpertReportsResponse {
  period_start: string;
  period_end: string;
  items: PipelineExpertReport[];
}

/** Настройки финансового модуля (политики учёта) */
export interface FinanceSettings {
  inventory_enabled: boolean;
  costing_method: string;
  revenue_goods_policy: string;
  revenue_services_policy: string;
  last_osv_import_from?: string | null;
  last_osv_import_to?: string | null;
  posting_locked_until?: string | null;
}

export interface FinanceWarehouse {
  id: number;
  name: string;
  code: string | null;
  is_active: boolean;
  sort_order: number;
  is_default: boolean;
}

export interface FinanceProduct {
  id: number;
  name: string;
  sku: string | null;
  product_type: string;
  unit: string;
  is_active: boolean;
}

export interface FinanceStockBalanceRow {
  product_id: number;
  product_name: string;
  warehouse_id: number;
  warehouse_name: string;
  quantity: string;
  avg_unit_cost: string;
  value: string;
}

export interface FinanceDashboardWarehouse {
  warehouse_id: number;
  warehouse_name: string;
  sku_positions: number;
  inventory_value: string;
}

export interface FinanceDashboard {
  warehouse_count: number;
  multi_warehouse: boolean;
  warehouses: FinanceDashboardWarehouse[];
  inventory_enabled: boolean;
  costing_method: string;
}

export interface FinanceDeferredContract {
  id: number;
  title: string;
  total_amount: string;
  period_count: number;
  start_date: string;
  end_date: string;
  memo: string | null;
}

export interface FinanceDeferredPeriod {
  id: number;
  period_no: number;
  amount: string;
  due_date: string;
  posted_at: string | null;
  journal_entry_id: number | null;
}

export interface FinanceAccount {
  id: number;
  code: string;
  name: string;
  account_type: string;
  is_system: boolean;
  is_active: boolean;
}

export interface FinanceJournalLineDetail {
  account_code: string;
  account_name: string;
  debit: string;
  credit: string;
  dimensions?: Record<string, unknown> | null;
}

export interface FinanceJournalEntryDetail {
  id: number;
  entry_date: string;
  memo: string | null;
  source_type: string;
  created_at: string;
  related_lead_id?: number | null;
  related_deal_id?: number | null;
  lines: FinanceJournalLineDetail[];
}

export interface FinanceReminderMessage {
  kind: string;
  text: string;
}

export interface FinanceRemindersOverview {
  messages: FinanceReminderMessage[];
}

export interface FinanceStockMovement {
  id: number;
  created_at: string;
  movement_type: string;
  qty_delta: string;
  unit_cost: string | null;
  memo: string | null;
  warehouse_id: number;
  warehouse_name: string;
  product_id: number;
  product_name: string;
}

export interface FinancePeriodSummary {
  date_from: string;
  date_to: string;
  revenue_total: string;
  expense_total: string;
  net_income: string;
  inventory_value: string;
  deferred_unrecognized: string;
  journal_entries_count: number;
  net_margin_pct?: string | null;
  budget_revenue_plan?: string | null;
  budget_expense_plan?: string | null;
  budget_revenue_variance_pct?: string | null;
  budget_expense_variance_pct?: string | null;
  budget_alert?: boolean;
}

export interface FinanceOsvImportResult {
  applied: boolean;
  date_from: string;
  date_to: string;
  rows_parsed: number;
  journal_entry_id?: number | null;
  warnings: string[];
  accounts_missing: string[];
}

export interface FinanceJournalTemplate {
  id: number;
  name: string;
  lines: Array<{ account_code: string; debit: string | number; credit: string | number }>;
  created_at: string;
}

export interface FinanceConsistency {
  debit_total: string;
  credit_total: string;
  balanced: boolean;
  difference: string;
  inventory_account_code: string;
  inventory_gl_net: string;
  inventory_stock_value: string;
}

export interface FinanceAccountTypeRollup {
  account_type: string;
  debit_total: string;
  credit_total: string;
  net_balance: string;
}

export interface FinanceTrialBalanceLine {
  account_code: string;
  account_name: string;
  account_type: string;
  debit_total: string;
  credit_total: string;
  net_balance: string;
}

export interface FinancePLLine {
  account_code: string;
  account_name: string;
  account_type: string;
  amount: string;
}

/** Упрощённый бухгалтерский баланс (на конец date_to) */
export interface FinanceBalanceSheetRow {
  section: string;
  line_kind: string;
  account_code?: string | null;
  label: string;
  amount: string;
}

export interface FinanceBalanceSheetReport {
  as_of_date: string;
  rows: FinanceBalanceSheetRow[];
  total_assets: string;
  total_liabilities: string;
  total_equity_accounts: string;
  retained_earnings: string;
  total_passive: string;
  balanced: boolean;
}

/** Упрощённый ДДС по счетам кассы и расчётного счёта */
export interface FinanceCashFlowBucket {
  bucket_key: string;
  label: string;
  amount: string;
}

export interface FinanceCashFlowReport {
  date_from: string;
  date_to: string;
  opening_cash: string;
  closing_cash: string;
  net_change: string;
  buckets: FinanceCashFlowBucket[];
}

export interface FinanceYearOverviewMonth {
  year: number;
  month: number;
  revenue_actual: string;
  expense_actual: string;
  net_actual: string;
  revenue_plan: string;
  expense_plan: string;
}

export interface FinanceForecastPoint {
  year: number;
  month: number;
  projected_revenue: string;
}

export interface FinanceForecast {
  baseline_months_used: number;
  average_monthly_revenue: string;
  points: FinanceForecastPoint[];
}

export interface FinanceBudgetMonthRow {
  year: number;
  month: number;
  revenue_plan: string;
  expense_plan: string;
  updated_at: string;
}

export interface BackgroundEventRow {
  ts: string;
  source: string;
  ok: boolean;
  message: string;
  detail: string | null;
}

export interface TariffStatus {
  max_active_users: number;
  max_integrations: number;
  active_users: number;
  integrations: number;
}

/** KPI продаж по воронке (эксперт) и менеджерам */
export interface SalesKpiPipelineMeta {
  id: number;
  name: string;
  expert_user_id: number | null;
  expert_name: string | null;
}

export interface SalesKpiDirectionMeta {
  direction_id: number;
  direction_name: string;
  unit_price: string;
}

export interface SalesKpiManagerCell {
  direction_id: number;
  plan_qty: number;
  plan_amount: string;
  actual_paid: string;
  actual_count: number;
  progress_percent: number | null;
}

export interface SalesKpiManagerRow {
  manager_id: number;
  manager_name: string;
  total_plan_amount: string;
  total_actual_paid: string;
  total_progress_percent: number | null;
  cells: SalesKpiManagerCell[];
}

export interface SalesKpiOwnerMatrix {
  pipeline_id: number;
  pipeline_name: string;
  year_month: string;
  directions: SalesKpiDirectionMeta[];
  managers: SalesKpiManagerRow[];
}

export interface SalesKpiManagerMatrix {
  pipeline_id: number;
  pipeline_name: string;
  year_month: string;
  directions: SalesKpiDirectionMeta[];
  manager: SalesKpiManagerRow;
}

export interface SalesKpiPriceHint {
  fixed_price: string | null;
  year_month: string;
  direction_id: number;
  direction_name: string | null;
  start_at: string;
}

export interface SalesKpiLeadPriceHint {
  fixed_price: string | null;
  year_month: string;
  direction_id: number | null;
  direction_name: string | null;
}
