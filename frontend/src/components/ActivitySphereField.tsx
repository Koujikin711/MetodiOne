import { useEffect, useState } from "react";

import { ACTIVITY_SPHERES } from "@/lib/activitySpheres";

const OTHER = "__other__";

type Props = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
  id?: string;
};

function isPresetSphere(v: string) {
  return (ACTIVITY_SPHERES as readonly string[]).includes(v);
}

export function ActivitySphereField({
  value,
  onChange,
  className = "mo-input mt-1 w-full",
  required,
  id,
}: Props) {
  const [otherMode, setOtherMode] = useState(() => Boolean(value.trim()) && !isPresetSphere(value));

  useEffect(() => {
    if (isPresetSphere(value)) setOtherMode(false);
    else if (value.trim()) setOtherMode(true);
  }, [value]);

  const selectValue = otherMode ? OTHER : value;

  return (
    <div className="space-y-2">
      <select
        id={id}
        required={required && !otherMode}
        value={selectValue || ""}
        className={className}
        onChange={(e) => {
          const next = e.target.value;
          if (next === OTHER) {
            setOtherMode(true);
            if (isPresetSphere(value)) onChange("");
            return;
          }
          setOtherMode(false);
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
      {otherMode ? (
        <input
          required={required}
          value={isPresetSphere(value) ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          className={className}
          placeholder="Напишите свою сферу…"
          autoComplete="off"
          autoFocus
        />
      ) : null}
    </div>
  );
}
