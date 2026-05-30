import type { ReactNode } from "react";

export type Segment<T extends string> = {
  id: T;
  label: string;
  count?: number;
  hint?: string;
};

type Props<T extends string> = {
  segments: Segment<T>[];
  value: T;
  onChange: (id: T) => void;
};

export function SegmentedControl<T extends string>({ segments, value, onChange }: Props<T>) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))` }}>
      {segments.map((seg) => {
        const active = value === seg.id;
        return (
          <button
            key={seg.id}
            type="button"
            onClick={() => onChange(seg.id)}
            className={[
              "flex min-h-[68px] flex-col items-center justify-center rounded-xl border px-1 py-2 text-center transition",
              active
                ? "border-[#d4af37] bg-white text-[var(--mo-text)] shadow-[var(--mo-shadow-luxury)] ring-1 ring-[#d4af37]/30"
                : "border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] mo-muted hover:border-[#d4af37]/50 hover:text-[var(--mo-text)]",
            ].join(" ")}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wide">{seg.label}</span>
            {seg.count != null ? (
              <span className="mt-0.5 text-lg font-bold tabular-nums text-[var(--mo-text)]">{seg.count}</span>
            ) : null}
            {seg.hint ? <span className="lux-caption mt-0.5 text-[9px] leading-tight">{seg.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
