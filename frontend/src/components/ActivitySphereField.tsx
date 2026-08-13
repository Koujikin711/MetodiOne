import { useMemo } from "react";

import { ACTIVITY_SPHERES } from "@/lib/activitySpheres";

const OTHER = "__other__";

type Props = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
  id?: string;
};

export function ActivitySphereField({
  value,
  onChange,
  className = "mo-input mt-1 w-full",
  required,
  id,
}: Props) {
  const isPreset = useMemo(
    () => (ACTIVITY_SPHERES as readonly string[]).includes(value),
    [value],
  );
  const selectValue = isPreset ? value : value.trim() ? OTHER : "";

  return (
    <div className="space-y-2">
      <select
        id={id}
        required={required && !value.trim()}
        value={selectValue}
        className={className}
        onChange={(e) => {
          const next = e.target.value;
          if (next === OTHER) {
            onChange(isPreset || !value.trim() ? "" : value);
            return;
          }
          onChange(next);
        }}
      >
        <option value="" disabled>
          Выберите…
        </option>
        {ACTIVITY_SPHERES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
        <option value={OTHER}>Другое</option>
      </select>
      {selectValue === OTHER ? (
        <input
          required={required}
          value={isPreset ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          className={className}
          placeholder="Укажите сферу…"
          autoComplete="off"
        />
      ) : null}
    </div>
  );
}
