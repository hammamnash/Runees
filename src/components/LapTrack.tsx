"use client";

export function LapTrack({ distanceM }: { distanceM: number | null }) {
  const d = distanceM ?? 0;
  const lapLen = 400;
  const lap = Math.floor(d / lapLen) + 1;
  const progress = (d % lapLen) / lapLen;
  const totalLaps = Math.ceil(Math.max(d, lapLen) / lapLen);
  const pct = Math.round(progress * 100);
  const circumference = 2 * Math.PI * 44;
  const dash = circumference * progress;

  return (
    <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 flex items-center gap-4">
      <div className="relative h-[100px] w-[100px] shrink-0">
        <svg width={100} height={100} className="-rotate-90">
          <circle cx={50} cy={50} r={44} fill="none" stroke="#27272a" strokeWidth={8} />
          <circle
            cx={50}
            cy={50}
            r={44}
            fill="none"
            stroke="#22c55e"
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
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
