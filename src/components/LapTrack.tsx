"use client";

export function LapTrack({ distanceM }: { distanceM: number | null }) {
  const d = distanceM ?? 0;
  const lapLen = 400;
  const lap = Math.floor(d / lapLen) + 1;
  const progress = (d % lapLen) / lapLen;
  const totalLaps = Math.ceil(Math.max(d, lapLen) / lapLen);
  const pct = Math.round(progress * 100);

  // Running-track (stadium) shape: two straights joined by semicircular bends
  const r = 30; // bend radius
  const straight = 32; // length of each straight
  const cx = 50;
  const cy = 50;
  const x1 = cx - straight / 2;
  const x2 = cx + straight / 2;
  const yTop = cy - r;
  const yBot = cy + r;
  const trackPath = `M ${x1} ${yTop} L ${x2} ${yTop} A ${r} ${r} 0 0 1 ${x2} ${yBot} L ${x1} ${yBot} A ${r} ${r} 0 0 1 ${x1} ${yTop} Z`;
  const perimeter = 2 * straight + 2 * Math.PI * r; // exact stadium perimeter
  const dash = perimeter * progress;

  return (
    <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 flex items-center gap-4">
      <div className="relative h-[100px] w-[100px] shrink-0">
        <svg width={100} height={100} viewBox="0 0 100 100">
          <path d={trackPath} fill="none" stroke="#27272a" strokeWidth={8} />
          <path
            d={trackPath}
            fill="none"
            stroke="#22c55e"
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${perimeter}`}
            style={{ transition: "stroke-dasharray 0.5s ease" }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="text-lg font-black">{pct}%</div>
            <div className="text-[10px] text-zinc-500">LAP {lap}</div>
          </div>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-zinc-500 uppercase tracking-widest">Track · 400m / lap</div>
        <div className="text-sm font-semibold">Lap {lap} · {(d % lapLen).toFixed(0)} / 400 m</div>
        <div className="text-xs text-zinc-500">{d.toFixed(0)} m total · {totalLaps} laps</div>
        <div className="mt-2 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
