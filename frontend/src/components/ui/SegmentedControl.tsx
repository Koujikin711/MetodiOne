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
                ? "border-[#3d7ab5]/60 bg-[#1a2838] text-white ring-1 ring-[#2d5f8a]/40"
                : "border-[#2a3644] bg-[#111820] text-slate-400 hover:border-[#3d556c] hover:text-slate-200",
            ].join(" ")}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wide">{seg.label}</span>
            {seg.count != null ? (
              <span className="mt-0.5 text-lg font-bold tabular-nums">{seg.count}</span>
            ) : null}
            {seg.hint ? <span className="mt-0.5 text-[9px] leading-tight opacity-80">{seg.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
