/** Чипы стадии: Архив + Удачно, или «был Удачно» после раздачи. */
export function leadStageChips(lead: {
  stage_name?: string | null;
  archived_from_stage?: string | null;
}): { primary: string; secondary?: string } {
  const stage = (lead.stage_name || "").trim();
  const from = (lead.archived_from_stage || "").trim();
  const fromLabel = from === "В обработке" ? "В работе" : from;
  const stageLabel = stage === "В обработке" ? "В работе" : stage;

  if (stage === "Архив" && fromLabel) {
    return { primary: fromLabel, secondary: "Архив" };
  }
  if ((stage === "Новый лид" || stage === "Новый") && fromLabel === "Удачно") {
    return { primary: "Новый", secondary: "был Удачно" };
  }
  return { primary: stageLabel || "—" };
}
