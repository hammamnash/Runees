"use client";

import { getAllZones, getZoneIndex, hrAtFraction, type HrZoneConfig } from "@/lib/hrZones";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * HrZoneGauge — 5 zone boxes (grey/blue/green/orange/red) with a marker line
 * for the current HR. The active zone box scales up (taller + wider) while the
 * others compress. Gauge scale spans Z1 lower bound → max HR; HR below the
 * scale clamps to the left edge.
 */
export function HrZoneGauge({ hr, cfg }: { hr: number | null; cfg: HrZoneConfig }) {
  const zones = getAllZones(cfg);
  const activeIdx = hr != null && hr > 0 ? getZoneIndex(hr, cfg) : -1;

  const scaleLow = hrAtFraction(zones[0].lowerPct, cfg);
  const scaleHigh = cfg.maxHr;
  const posPct =
    hr != null && hr > 0 && scaleHigh > scaleLow
      ? clamp(((hr - scaleLow) / (scaleHigh - scaleLow)) * 100, 1.5, 98.5)
      : null;

  const activeColor = activeIdx >= 0 ? zones[activeIdx].color : "text-white";

  return (
    <div className="relative pt-4" aria-hidden>
      {/* Zone boxes — active one grows in height and width */}
      <div className="flex h-5 items-end gap-1">
        {zones.map((z, i) => {
          const active = i === activeIdx;
          return (
            <div
              key={z.zone}
              className={`${z.bg} rounded-sm transition-all duration-300 ${
                active ? "h-5 flex-[1.8] opacity-100" : "h-2.5 flex-1 opacity-75"
              }`}
            />
          );
        })}
      </div>
      {/* HR marker line + small value */}
      {posPct != null ? (
        <div
          className="pointer-events-none absolute bottom-0 top-0 -translate-x-1/2"
          style={{ left: `${posPct}%` }}
        >
          <div className="absolute bottom-0 top-4 w-0.5 rounded-full bg-white/80" />
        </div>
      ) : null}
    </div>
  );
}
