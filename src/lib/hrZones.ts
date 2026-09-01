export type HrZoneMethod = "max" | "hrr";

export interface HrZone {
  zone: number;
  label: string;
  color: string;
  bg: string;
  // Lower bound of the zone as a percentage (0-1). Z1 lower bound = resting/base.
  lowerPct: number;
  upperPct: number;
}

export interface HrZoneConfig {
  method: HrZoneMethod;
  maxHr: number;
  restingHr: number;
}

// Fixed standard zone boundaries (as fractions). HRMax and HRR both use the
// same boundaries; HRR shifts the whole scale by resting HR (Karvonen).
const ZONES: HrZone[] = [
  { zone: 1, label: "Z1 Recovery", color: "text-zinc-400", bg: "bg-zinc-600", lowerPct: 0.5, upperPct: 0.6 },
  { zone: 2, label: "Z2 Aerobic", color: "text-sky-400", bg: "bg-sky-600", lowerPct: 0.6, upperPct: 0.7 },
  { zone: 3, label: "Z3 Tempo", color: "text-emerald-400", bg: "bg-emerald-600", lowerPct: 0.7, upperPct: 0.8 },
  { zone: 4, label: "Z4 Threshold", color: "text-orange-400", bg: "bg-orange-600", lowerPct: 0.8, upperPct: 0.9 },
  { zone: 5, label: "Z5 VO2Max", color: "text-red-400", bg: "bg-red-600", lowerPct: 0.9, upperPct: 1 },
];

// Compute the HR (bpm) at a given fraction using the selected method.
export function hrAtFraction(fraction: number, cfg: HrZoneConfig): number {
  if (cfg.method === "hrr") {
    const range = cfg.maxHr - cfg.restingHr;
    return Math.round(cfg.restingHr + fraction * range);
  }
  return Math.round(fraction * cfg.maxHr);
}

// Compute the numeric bpm range for a zone (inclusive lower → exclusive upper).
export function getZoneRange(zone: HrZone, cfg: HrZoneConfig): { low: number; high: number } {
  return {
    low: hrAtFraction(zone.lowerPct, cfg),
    high: hrAtFraction(zone.upperPct, cfg),
  };
}

// Find the zone index (0-4) for a given HR using the selected method.
export function getZoneIndex(hr: number, cfg: HrZoneConfig): number {
  if (!hr || hr <= 0) return -1;
  for (let i = 0; i < ZONES.length; i++) {
    const low = hrAtFraction(ZONES[i].lowerPct, cfg);
    const high = hrAtFraction(ZONES[i].upperPct, cfg);
    if (hr < high && hr >= low) return i;
  }
  // Below the lowest zone boundary → Z1 (recovery).
  const firstLow = hrAtFraction(ZONES[0].lowerPct, cfg);
  if (hr < firstLow) return 0;
  // Above the top boundary → Z5.
  return ZONES.length - 1;
}

export function getHrZone(hr: number, maxHr = 190, cfg?: Partial<HrZoneConfig>): HrZone | null {
  const effective: HrZoneConfig = {
    method: cfg?.method ?? "max",
    maxHr: cfg?.maxHr ?? maxHr,
    restingHr: cfg?.restingHr ?? Math.round(maxHr * 0.4),
  };
  const idx = getZoneIndex(hr, effective);
  if (idx < 0) return null;
  return ZONES[idx];
}

export function getAllZones(cfg: HrZoneConfig): HrZone[] {
  return ZONES;
}

export function garminDefaultMaxHr(age = 30): number {
  return 220 - age;
}
