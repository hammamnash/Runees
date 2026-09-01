import type { ReactNode } from "react";

export function MetricCard({
  label,
  value,
  unit,
  sub,
  colorClass,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  colorClass?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="eyebrow !text-ash">{label}</div>
      <div className={`metric-num text-5xl lg:text-6xl ${colorClass || "text-white"}`}>
        {value} {unit ? <span className="text-2xl font-light text-ash">{unit}</span> : null}
      </div>
      {sub ? <div className="text-body-light text-sm text-ash">{sub}</div> : null}
    </div>
  );
}
