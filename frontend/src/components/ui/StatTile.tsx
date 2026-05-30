type Props = {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "sales" | "service" | "warning" | "chat";
  onClick?: () => void;
};

const toneBorder: Record<NonNullable<Props["tone"]>, string> = {
  default: "border-[#d8d2c6]",
  sales: "border-[#2f5f85]/40",
  service: "border-[#2d6a5a]/40",
  warning: "border-[#c9b07a]/60",
  chat: "border-[#2d6a5a]/50",
};

export function StatTile({ label, value, hint, tone = "default", onClick }: Props) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={[
        "rounded-2xl border bg-white p-4 text-left transition shadow-sm",
        toneBorder[tone],
        onClick ? "hover:border-[#2f5f85]/50 hover:shadow-md" : "",
      ].join(" ")}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-[#5c6b7a]">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-[#1e3348]">{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-[#8a96a3]">{hint}</div> : null}
    </Tag>
  );
}
