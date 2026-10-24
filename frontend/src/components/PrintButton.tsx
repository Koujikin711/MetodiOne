import { Printer } from "@/components/icons";

export function PrintButton({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      className={[
        "journal-icon-btn print-hide inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--mo-border-strong)] bg-[var(--mo-surface-elevated)] text-[var(--mo-text)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Печать"
      title="Печать"
      onClick={() => window.print()}
    >
      <Printer className="h-5 w-5" />
      <span className="journal-icon-btn__tip" role="tooltip">
        Печать
      </span>
    </button>
  );
}
