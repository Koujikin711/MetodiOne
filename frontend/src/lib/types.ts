export type UserRole = "admin" | "manager";

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
}

export type TaskStatus = "pending" | "in_progress" | "done" | "cancelled";

export interface Task {
  id: number;
  title: string;
  deadline: string | null;
  status: TaskStatus;
  assigned_to: number | null;
  description: string | null;
  related_lead_id?: number | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface LeadStatusPatchResponse extends Lead {
  automation_task_created: boolean;
}

export interface AnalyticsSummary {
  total_leads: number;
  deals_total_amount: string;
  conversion_percent: number;
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
  is_active: boolean;
}

export interface BookingAppointment {
  id: number;
  lead_id: number | null;
  patient_name: string;
  patient_phone: string;
  start_at: string;
  end_at: string;
  status: string;
  responsible_manager_id: number | null;
  direction_name: string | null;
  specialist_name: string | null;
  comment: string | null;
}
