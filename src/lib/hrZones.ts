export interface HrZone {
  zone: number;
  label: string;
  color: string;
  bg: string;
}

const ZONES: HrZone[] = [
  { zone: 1, label: "Z1 Recovery", color: "text-zinc-400", bg: "bg-zinc-600" },
  { zone: 2, label: "Z2 Aerobic", color: "text-sky-400", bg: "bg-sky-600" },
  { zone: 3, label: "Z3 Tempo", color: "text-emerald-400", bg: "bg-emerald-600" },
  { zone: 4, label: "Z4 Threshold", color: "text-orange-400", bg: "bg-orange-600" },
  { zone: 5, label: "Z5 VO2Max", color: "text-red-400", bg: "bg-red-600" },
];

export function getHrZone(hr: number, maxHr = 190): HrZone | null {
  if (!hr || hr <= 0) return null;
  const pct = hr / maxHr;
  if (pct < 0.6) return ZONES[0];
  if (pct < 0.7) return ZONES[1];
  if (pct < 0.8) return ZONES[2];
  if (pct < 0.9) return ZONES[3];
  return ZONES[4];
}

export function garminDefaultMaxHr(age = 30): number {
  return 220 - age;
}
