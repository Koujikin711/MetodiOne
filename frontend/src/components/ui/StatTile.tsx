type Props = {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "sales" | "service" | "warning" | "chat";
  onClick?: () => void;
};

const toneBorder: Record<NonNullable<Props["tone"]>, string> = {
  default: "border-[var(--mo-border)]",
  sales: "border-[var(--mo-accent)]/40",
  service: "border-[var(--mo-success)]/40",
  warning: "border-[var(--mo-warning)]/50",
  chat: "border-[var(--mo-accent)]/45",
};

export function StatTile({ label, value, hint, tone = "default", onClick }: Props) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={[
        "rounded-2xl border bg-[var(--mo-surface-elevated)] p-4 text-left shadow-[var(--mo-shadow-luxury)] transition",
        toneBorder[tone],
        onClick ? "hover:border-[var(--mo-accent)]/50 hover:shadow-md" : "",
      ].join(" ")}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--mo-text-muted)]">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold tabular-nums text-[var(--mo-text)]">{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-[var(--mo-text-muted)]">{hint}</div> : null}
    </Tag>
  );
}
