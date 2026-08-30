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
  sub?: string;
  colorClass?: string;
}) {
  return (
    <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-6 flex flex-col gap-2">
      <div className="text-xs tracking-widest text-zinc-500 uppercase">{label}</div>
      <div className={`text-5xl font-black tabular-nums ${colorClass || "text-white"}`}>
        {value} {unit ? <span className="text-xl font-semibold text-zinc-400">{unit}</span> : null}
      </div>
      {sub ? <div className="text-sm text-zinc-400">{sub}</div> : null}
    </div>
  );
}
