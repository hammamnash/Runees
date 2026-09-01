"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import type { FitRecord } from "@/lib/fitEncoder";

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function LiveChart({ records }: { records: FitRecord[] }) {
  if (records.length < 2) {
    return <div className="text-xs text-zinc-500 py-8 text-center">Start recording to see live chart</div>;
  }
  const data = records.map((r, i) => ({
    t: i,
    label: formatTime(i),
    hr: r.heartRate ?? null,
    pace: r.speedMs != null && r.speedMs >= 0.2 ? +(1000 / (r.speedMs * 60)).toFixed(2) : null,
  }));

  // Auto-fitting axes: pad the observed range, clamped to sane bounds
  const hrValues = data.map((d) => d.hr).filter((v): v is number => v != null);
  const paceValues = data.map((d) => d.pace).filter((v): v is number => v != null);

  const hrDomain: [number, number] =
    hrValues.length > 0
      ? [
          Math.max(60, Math.floor(Math.min(...hrValues)) - 10),
          Math.min(200, Math.ceil(Math.max(...hrValues)) + 10),
        ]
      : [80, 200];
  if (hrDomain[1] - hrDomain[0] < 20) hrDomain[1] = hrDomain[0] + 20;

  const paceDomain: [number, number] =
    paceValues.length > 0
      ? [
          Math.max(2, Math.floor(Math.min(...paceValues) - 0.25)),
          Math.min(15, Math.ceil(Math.max(...paceValues) + 0.25)),
        ]
      : [3, 8];
  if (paceDomain[1] - paceDomain[0] < 1) paceDomain[1] = paceDomain[0] + 1;

  const paceFormatter = (v: number) => {
    if (v == null || !isFinite(v)) return "";
    const m = Math.floor(v);
    const s = Math.round((v - m) * 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#1c1c1c" strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fill: "#9a9a9a", fontSize: 10 }} interval="preserveStartEnd" minTickGap={30} stroke="#2a2a2a" />
          <YAxis yAxisId="hr" tick={{ fill: "#f87171", fontSize: 10 }} domain={hrDomain} width={30} stroke="#2a2a2a" />
          <YAxis
            yAxisId="pace"
            orientation="right"
            reversed
            tick={{ fill: "#ffb829", fontSize: 10 }}
            domain={paceDomain}
            width={38}
            tickFormatter={paceFormatter}
            stroke="#2a2a2a"
          />
          <Tooltip
            contentStyle={{ background: "#000000", border: "1px solid #2a2a2a", borderRadius: 12, fontSize: 12 }}
            formatter={(value: unknown, name) => {
              if (name === "Pace min/km" && typeof value === "number") return [paceFormatter(value), String(name)];
              return [value as string, String(name)];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line yAxisId="hr" type="monotone" dataKey="hr" name="HR bpm" stroke="#ef4444" dot={false} strokeWidth={1.5} connectNulls />
          <Line yAxisId="pace" type="monotone" dataKey="pace" name="Pace min/km" stroke="#ffb829" dot={false} strokeWidth={1.2} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
