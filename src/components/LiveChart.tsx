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
  const paceFormatter = (v: number) => {
    if (v == null || !isFinite(v)) return "";
    const m = Math.floor(v);
    const s = Math.round((v - m) * 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 10 }} interval="preserveStartEnd" minTickGap={30} />
          <YAxis yAxisId="hr" tick={{ fill: "#f87171", fontSize: 10 }} domain={[80, 200]} width={30} />
          <YAxis
            yAxisId="pace"
            orientation="right"
            reversed
            tick={{ fill: "#22c55e", fontSize: 10 }}
            domain={[3, 8]}
            width={38}
            tickFormatter={paceFormatter}
          />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "1px solid #27272a", fontSize: 12 }}
            formatter={(value: unknown, name) => {
              if (name === "Pace min/km" && typeof value === "number") return [paceFormatter(value), String(name)];
              return [value as string, String(name)];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line yAxisId="hr" type="monotone" dataKey="hr" name="HR bpm" stroke="#ef4444" dot={false} strokeWidth={1.5} connectNulls />
          <Line yAxisId="pace" type="monotone" dataKey="pace" name="Pace min/km" stroke="#22c55e" dot={false} strokeWidth={1.2} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
