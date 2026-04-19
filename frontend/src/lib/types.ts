export type UserRole = "super_owner" | "owner" | "admin" | "manager" | "expert";

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
  provider: string;
  external_chat_id: string | null;
  title: string | null;
  pipeline_id: number | null;
  updated_at: string;
  /** Входящие от клиента, не просмотренные в этом диалоге */
  unread_count?: number;
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

export interface BookingDirection {
  id: number;
  name: string;
  duration_min: number;
  is_active: boolean;
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
}

export interface FinanceJournalEntryDetail {
  id: number;
  entry_date: string;
  memo: string | null;
  source_type: string;
  created_at: string;
  lines: FinanceJournalLineDetail[];
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
