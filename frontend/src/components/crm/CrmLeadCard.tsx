import type { ReactNode } from "react";

import type { LeadRead } from "@/lib/types";

type Props = {
  lead: LeadRead;
  onOpen?: () => void;
  dragHandle?: ReactNode;
};

/** Карточка лида для канбана (CRM 2.0). */
export function CrmLeadCard({ lead, onOpen, dragHandle }: Props) {
  return (
    <article
      className="mo-card cursor-pointer space-y-1.5 border-[#d8d2c6] bg-white p-3 shadow-sm transition hover:border-[#2f5f85]/40 hover:shadow-md"
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen?.()}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[#1e3348]">{lead.name}</div>
          {lead.phone ? <div className="truncate text-xs text-[#5c6b7a]">{lead.phone}</div> : null}
        </div>
        {dragHandle}
      </div>
      {lead.manager_name ? (
        <div className="text-[11px] text-[#5c6b7a]">Ответственный: {lead.manager_name}</div>
      ) : null}
      {lead.stage_name ? (
        <span className="inline-block rounded-md bg-[#e8f0f7] px-2 py-0.5 text-[10px] font-medium text-[#2f5f85]">
          {lead.stage_name}
        </span>
      ) : null}
    </article>
  );
}
