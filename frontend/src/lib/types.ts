export type UserRole = "super_owner" | "owner" | "admin" | "manager" | "expert" | "finance_analyst" | "accountant";

export interface User {
  id: number;
  email: string;
  role: UserRole;
}

export interface UserMe extends User {
  company_id?: number | null;
  phone?: string | null;
  full_name?: string | null;
  must_change_password?: boolean;
  impersonated_by_user_id?: number | null;
  is_chief_expert?: boolean;
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
  /** Номера, которые менеджеры могут отправлять в чате этой воронки */
  manager_allowed_outbound_phones?: string[];
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

export interface GreenBroadcastResult {
  requested_count: number;
  sent_count: number;
  failed_count: number;
  failed_numbers: string[];
}

export interface GreenBroadcastPreviewRead {
  found_count: number;
  unique_count: number;
  limited_count: number;
}

export interface ChatThread {
  id: number;
  lead_id: number | null;
  lead_name: string | null;
  lead_phone?: string | null;
  lead_phone_display?: string | null;
  lead_phone_can_view_full?: boolean;
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
  /** Лид передан менеджеру при перераспределении */
  is_transferred?: boolean;
  sale_service_title?: string | null;
  sale_amount?: string | null;
  sale_paid_amount?: string | null;
}

export type ChatThreadBucket = "transferred" | "own" | "awaiting_reply" | "sold";

export interface ChatThreadBucketCounts {
  transferred: number;
  own: number;
  awaiting_reply: number;
  sold: number;
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
  phone_display?: string | null;
  phone_can_view_full?: boolean;
  pipeline_id?: number | null;
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
  clients_messaged_count: number;
  manager_replied_count: number;
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
  course_streams_enabled?: boolean;
  course_stream_max_days?: number;
  course_stream_min_day_for_next?: number;
  course_stream_gap_days?: number;
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
  /** Курсы: нумерация поток:день (1:1, 1:10, 2:1) */
  course_streams_enabled?: boolean;
  course_stream_max_days?: number;
  course_stream_min_day_for_next?: number;
  course_stream_gap_days?: number;
}

export interface BookingAppointment {
  id: number;
  lead_id: number | null;
  specialist_id: number;
  direction_id: number;
  patient_name: string;
  patient_phone: string;
  patient_phone_display?: string | null;
  patient_phone_can_view_full?: boolean;
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
  /** Номер визита или день в потоке */
  visit_number?: number | null;
  /** Поток:день, например 1:10 */
  visit_label?: string | null;
  visit_stream?: number | null;
  visit_stream_day?: number | null;
  /** WhatsApp-подтверждение записи отправлено */
  whatsapp_confirmation_sent?: boolean;
}

/** Правила отображения номера сеанса в онлайн-записи (главный эксперт воронки). */
export interface BookingViewerContext {
  is_chief_expert: boolean;
  show_session_instead_of_time: boolean;
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
  patient_phone_display?: string | null;
  patient_phone_can_view_full?: boolean;
  total_visits: number;
  first_visit_at: string | null;
  last_visit_at: string | null;
  visits: BookingPatientVisit[];
}

export interface BookingPatientSuggestItem {
  lead_id: number | null;
  patient_name: string;
  patient_phone: string;
  patient_phone_display?: string | null;
  patient_phone_can_view_full?: boolean;
  manager_name: string | null;
  source: "crm" | "visits" | string;
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
  first_visit_patients: number;
  repeat_patients: number;
  sessions_total: number;
}

export interface DirectionPaymentSummary {
  direction_id: number;
  direction_name: string;
  appointments_paid: number;
  appointments_billed: number;
  installments_paid: number;
}

export interface PipelineExpertReport {
  pipeline_id: number;
  pipeline_name: string;
  patients_booked: number;
  patients_arrived: number;
  first_visit_patients: number;
  repeat_patients: number;
  sessions_total: number;
  direction_payments?: DirectionPaymentSummary[];
  experts: ExpertBookingItem[];
}

export interface ExpertReportsResponse {
  period_start: string;
  period_end: string;
  items: PipelineExpertReport[];
}

export interface FinanceOsvRow {
  id: number;
  txn_date: string;
  partner_amount?: string | null;
  service_period?: string | null;
  revenue: string | number;
  expense: string | number;
  bank?: string | null;
  basis?: string | null;
  counterparty?: string | null;
  phone?: string | null;
  via_person?: string | null;
  product_service?: string | null;
  article?: string | null;
  detail_category?: string | null;
  brief_category?: string | null;
  source: string;
  created_at: string;
}

export interface FinanceOsvSummary {
  revenue_total: string | number;
  expense_total: string | number;
  balance: string | number;
  rows: FinanceOsvRow[];
}

export interface FinanceReportCellRow {
  key: string;
  label: string;
  kind?: string;
  values: (string | number)[];
  total: string | number;
  bold?: boolean;
  indent?: number;
}

export interface FinanceReportGroup {
  key: string;
  label: string;
  kind?: string;
  rows: FinanceReportCellRow[];
}

export interface FinanceReportSection {
  key: string;
  label: string;
  kind?: string;
  groups: FinanceReportGroup[];
}

export interface FinanceDdsReport {
  year: number;
  month_labels: string[];
  opening_balance: (string | number)[];
  closing_balance: (string | number)[];
  sections: FinanceReportSection[];
}

export interface FinanceOpiuReport {
  year: number;
  month_labels: string[];
  rows: FinanceReportCellRow[];
}

export interface FinanceSettings {
  osv_sheet_url?: string | null;
  osv_sheet_name?: string | null;
  last_osv_import_from?: string | null;
  last_osv_import_to?: string | null;
  google_sheets_ready: boolean;
  service_account_email?: string | null;
}

export interface FinanceIntegrationStatus {
  gmail_connected: boolean;
  gmail_email?: string | null;
  sheets_connected: boolean;
  osv_sheet_url?: string | null;
  osv_sheet_name?: string | null;
  last_sync_at?: string | null;
  last_osv_import_from?: string | null;
  last_osv_import_to?: string | null;
  osv_rows_count: number;
}

export interface FinanceIntegrateResult {
  gmail_connected: boolean;
  sheets_connected?: boolean;
  osv_sheet_url?: string | null;
  osv_sheet_name?: string | null;
  imported_from_sheets?: number;
  imported_from_gmail: number;
  imported_from_crm: number;
  skipped_duplicates: number;
  osv_rows_count: number;
  message: string;
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

export interface SalesKpiPlanItem {
  id: number;
  name: string;
  plan_qty: number;
  weight_percent: string | number;
  source_type: "direction" | "manual" | string;
  direction_id: number | null;
  specialist_ids: number[];
  sort_order: number;
}

export interface SalesKpiSpecialistMeta {
  id: number;
  full_name: string;
  direction_id: number;
  direction_name: string | null;
  is_active: boolean;
}

export interface SalesKpiWeightedPlan {
  pipeline_id: number;
  pipeline_name: string;
  year_month: string;
  bonus_fund: string | number;
  items: SalesKpiPlanItem[];
  directions: SalesKpiDirectionMeta[];
  specialists: SalesKpiSpecialistMeta[];
  managers: { id: number; name: string }[];
}

export interface SalesKpiBoardLine {
  plan_item_id: number;
  name: string;
  source_type: string;
  direction_id: number | null;
  specialist_ids?: number[];
  plan_qty: number;
  weight_percent: string | number;
  fact_qty: number;
  completion: number | null;
  contribution: string | number;
}

export interface SalesKpiBoardManager {
  manager_id: number;
  manager_name: string;
  lines: SalesKpiBoardLine[];
  total_contribution: string | number;
  bonus: string | number;
  bonus_fund: string | number;
}

export interface SalesKpiSalesReport {
  pipeline_id: number;
  pipeline_name: string;
  year_month: string;
  bonus_fund: string | number;
  items: SalesKpiPlanItem[];
  managers: SalesKpiBoardManager[];
}

export interface SalesKpiManualSale {
  id: number;
  pipeline_id: number;
  plan_item_id: number;
  plan_item_name: string;
  manager_user_id: number;
  manager_name: string;
  client_name: string;
  client_phone: string;
  service_amount: string | number;
  paid_amount: string | number;
  debt_amount: string | number;
  sold_at: string;
  status: string;
  returned_at: string | null;
  note: string | null;
  counts_in_kpi: boolean;
}

export interface SalesKpiDebtorRow {
  source: "booking" | "manual" | string;
  source_id: number;
  sold_at: string | null;
  client_name: string;
  client_phone: string;
  indicator_name: string;
  manager_id: number | null;
  manager_name: string | null;
  service_amount: string | number;
  paid_amount: string | number;
  debt_amount: string | number;
  status: string;
}

export interface SalesKpiDebtorsReport {
  pipeline_id: number;
  pipeline_name: string;
  year_month: string;
  rows: SalesKpiDebtorRow[];
  total_debt: string | number;
}

export interface PaymentRuleCreate {
  sort_order: number;
  label?: string | null;
  kind: "percent" | "fixed";
  value: number;
  trigger_type: string;
  trigger_day?: number | null;
  trigger_days_offset?: number | null;
}

export interface PaymentRuleRead extends PaymentRuleCreate {
  id: number;
}

export interface ServiceTemplateRead {
  id: number;
  pipeline_id: number;
  direction_id: number | null;
  name: string;
  service_type: string;
  duration_days: number | null;
  visit_count: number | null;
  price_base: number | string;
  specialist_ids: number[];
  course_streams_enabled: boolean;
  is_active: boolean;
  is_legacy: boolean;
  payment_rules: PaymentRuleRead[];
}

export interface InstallmentRead {
  id: number;
  sort_order: number;
  label: string | null;
  amount: number | string;
  due_date: string;
  status: string;
  paid_at?: string | null;
}

export interface EnrollmentRead {
  id: number;
  lead_id: number;
  template_id: number;
  pipeline_id: number;
  template_name?: string | null;
  status: string;
  total_price: number | string;
  started_at: string;
  installments: InstallmentRead[];
}

export interface ReceivablesSummaryRead {
  pending_count: number;
  overdue_count: number;
  paid_month_amount: number | string;
  overdue_amount: number | string;
  items: {
    installment_id: number;
    lead_id: number;
    lead_name: string;
    template_name: string;
    label: string | null;
    amount: number | string;
    due_date: string;
    status: string;
    days_overdue: number;
  }[];
}

