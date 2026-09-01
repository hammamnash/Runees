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
    <div className="flex items-center gap-6">
      <div className="relative h-[110px] w-[110px] shrink-0">
        <svg width={110} height={110} viewBox="0 0 100 100">
          <path d={trackPath} fill="none" stroke="#1c1c1c" strokeWidth={7} />
          <path
            d={trackPath}
            fill="none"
            stroke="#8052ff"
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${perimeter}`}
            style={{ transition: "stroke-dasharray 0.5s ease" }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="metric-num text-xl text-white">{pct}%</div>
            <div className="text-[10px] uppercase tracking-nav text-ash">LAP {lap}</div>
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="eyebrow !text-ash mb-2">Track · 400m / lap</div>
        <div className="text-sm font-light text-white">Lap {lap} · {(d % lapLen).toFixed(0)} / 400 m</div>
        <div className="text-xs font-light text-ash">{d.toFixed(0)} m total · {totalLaps} laps</div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-iris transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
