/** Человекочитаемые подписи для системного аудита. */

export type AuditSection = {
  value: string;
  label: string;
  hint: string;
};

/** Куда зашёл — фильтр по разделу (entity_type). */
export const AUDIT_SECTIONS: AuditSection[] = [
  { value: "", label: "Все разделы", hint: "" },
  { value: "lead", label: "CRM · клиенты", hint: "Карточки клиентов, статусы, отказы" },
  { value: "booking_appointment", label: "Онлайн-запись · записи", hint: "Создание, перенос, оплата, статус" },
  { value: "specialist", label: "Онлайн-запись · специалисты", hint: "График, направление, удаление" },
  { value: "booking_direction", label: "Онлайн-запись · направления", hint: "Услуги / направления записи" },
  { value: "employee", label: "Сотрудники", hint: "Профиль и воронки сотрудника" },
  { value: "pipeline", label: "Воронки", hint: "Создание, закрытие, раздача лидов" },
  { value: "stage", label: "Этапы воронки", hint: "Добавление и удаление этапов" },
  { value: "company", label: "Компании", hint: "Тарифы и контекст (super)" },
];

const ENTITY_PLACE: Record<string, { place: string; object: string }> = {
  lead: { place: "CRM", object: "клиент" },
  booking_appointment: { place: "Онлайн-запись", object: "запись" },
  specialist: { place: "Онлайн-запись", object: "специалист" },
  booking_direction: { place: "Онлайн-запись", object: "направление" },
  employee: { place: "Сотрудники", object: "сотрудник" },
  pipeline: { place: "Воронки", object: "воронка" },
  stage: { place: "Воронки", object: "этап" },
  company: { place: "Компании", object: "компания" },
};

const ACTION_LABELS: Record<string, string> = {
  // lead
  card_opened: "Открыл(а) карточку клиента",
  lead_created: "Создал(а) клиента",
  lead_imported: "Импортировал(а) клиента",
  lead_profile_updated: "Изменил(а) данные клиента",
  lead_rejected: "Отклонил(а) клиента",
  status_changed: "Сменил(а) этап / статус",
  manager_reassigned: "Сменил(а) ответственного менеджера",
  leads_redistributed: "Перераспределил(а) лиды",
  leads_redistributed_from_owners: "Забрал(а) лиды у владельца/админов → менеджерам",
  arrival_marked: "Отметил(а) приход клиента",
  no_show_processed: "Отметил(а) неявку",
  service_done: "Отметил(а) услугу выполненной",
  service_rejected: "Отметил(а) отказ от услуги",
  extra_service_added: "Добавил(а) доп. услугу",
  protocol_finished: "Завершил(а) протокол",
  integration_deal_closed: "Закрыл(а) сделку (интеграция)",
  whatsapp_welcome_sent: "Отправлено приветствие в WhatsApp",
  whatsapp_confirm_sent: "Отправлено подтверждение записи в WhatsApp",
  ingested: "Получено сообщение из канала",

  // booking
  appointment_created: "Создал(а) запись на приём",
  appointment_moved: "Перенёс(ла) запись",
  appointment_details_updated: "Изменил(а) заметку / детали записи",
  appointment_status_updated: "Изменил(а) статус записи",
  appointment_payment_updated: "Изменил(а) оплату записи",
  appointment_deleted: "Удалил(а) запись",
  specialist_updated: "Изменил(а) специалиста",
  specialist_deactivated: "Скрыл(а) специалиста из сетки",
  specialist_deleted: "Удалил(а) специалиста",
  specialists_reordered: "Изменил(а) порядок специалистов",
  specialist_created: "Добавил(а) специалиста",
  booking_direction_created: "Создал(а) направление записи",
  booking_direction_restored_on_create: "Восстановил(а) направление записи",
  booking_direction_merged: "Объединил(а) направления записи",

  // employees / pipelines
  employee_updated: "Изменил(а) сотрудника",
  employee_pipelines_updated: "Изменил(а) воронки сотрудника",
  pipeline_created: "Создал(а) воронку",
  pipeline_updated: "Изменил(а) воронку",
  pipeline_deleted: "Удалил(а) воронку",
  pipeline_closed: "Закрыл(а) воронку",
  pipeline_leads_exported: "Выгрузил(а) лиды воронки",
  pipeline_leads_distributed: "Раздал(а) лиды воронки",
  stage_created: "Добавил(а) этап воронки",
  stage_deleted: "Удалил(а) этап воронки",

  // company
  company_create: "Создал(а) компанию",
  company_status: "Изменил(а) статус компании",
  company_tariff_patch: "Изменил(а) тариф компании",
  company_tariff_plan: "Назначил(а) тарифный план",
  company_billing_discount: "Изменил(а) скидку",
  company_scheduled_tariff: "Запланировал(а) смену тарифа",
  company_switch_context: "Переключил(а) контекст компании",
  impersonate_owner: "Вошёл(а) от имени владельца",
};

const DETAIL_KEYS: Record<string, string> = {
  status: "статус",
  lead_id: "клиент №",
  specialist_id: "специалист №",
  direction_id: "направление №",
  start_at: "начало",
  full_name: "имя",
  pipeline_id: "воронка №",
  stage_id: "этап №",
  from_manager_id: "от сотрудника №",
  to_manager_id: "новому менеджеру №",
  manager_id: "менеджер №",
  to_manager_ids: "менеджерам",
  reassigned: "перенесено",
  paid_amount: "оплата",
  service_amount: "стоимость",
  comment: "заметка",
};

const STATUS_VALUES: Record<string, string> = {
  booked: "записан",
  completed: "завершён",
  cancelled: "отменён",
  no_show: "не явился",
};

export function auditPlaceLabel(entityType: string, entityId: number | null | undefined): string {
  const meta = ENTITY_PLACE[entityType] ?? { place: "Система", object: entityType || "объект" };
  const idPart = entityId != null && entityId > 0 ? ` №${entityId}` : "";
  return `${meta.place} · ${meta.object}${idPart}`;
}

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replaceAll("_", " ");
}

function formatDetailValue(key: string, raw: string): string {
  if (key === "status") return STATUS_VALUES[raw] ?? raw;
  if (key === "start_at") {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString("ru-RU");
  }
  return raw;
}

/** Превращает details вида `status=completed, lead_id=1` в читаемый текст. */
export function auditDetailsLabel(details: string | null | undefined): string | null {
  if (!details?.trim()) return null;
  const text = details.trim();
  if (!text.includes("=")) return text;

  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) {
      out.push(part);
      continue;
    }
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    const keyRu = DETAIL_KEYS[key] ?? key;
    out.push(`${keyRu} ${formatDetailValue(key, val)}`.trim());
  }
  return out.join(" · ");
}
