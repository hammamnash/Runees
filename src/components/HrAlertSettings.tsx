"use client";
import { useEffect, useRef, useState } from "react";

const LS_MAX = "runees_maxHr";
const LS_ALERT = "runees_hrAlert";
const LS_ENABLED = "runees_hrAlertEnabled";

export function HrAlertSettings({ hr }: { hr: number | null }) {
  const [maxHr, setMaxHr] = useState(190);
  const [threshold, setThreshold] = useState(175);
  const [enabled, setEnabled] = useState(false);
  const lastAlertRef = useRef(0);

  useEffect(() => {
    const m = localStorage.getItem(LS_MAX);
    const t = localStorage.getItem(LS_ALERT);
    const e = localStorage.getItem(LS_ENABLED);
    if (m) setMaxHr(parseInt(m, 10));
    if (t) setThreshold(parseInt(t, 10));
    if (e) setEnabled(e === "1");
  }, []);

  useEffect(() => { localStorage.setItem(LS_MAX, String(maxHr)); }, [maxHr]);
  useEffect(() => { localStorage.setItem(LS_ALERT, String(threshold)); }, [threshold]);
  useEffect(() => { localStorage.setItem(LS_ENABLED, enabled ? "1" : "0"); }, [enabled]);

  useEffect(() => {
    if (!enabled || hr == null) return;
    if (hr >= threshold && Date.now() - lastAlertRef.current > 10000) {
      lastAlertRef.current = Date.now();
      try {
        const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = 880;
        o.connect(g);
        g.connect(ctx.destination);
        g.gain.setValueAtTime(0.3, ctx.currentTime);
        o.start();
        o.stop(ctx.currentTime + 0.25);
        setTimeout(() => ctx.close(), 500);
      } catch {}
      if ("vibrate" in navigator) navigator.vibrate(200);
    }
  }, [hr, threshold, enabled]);

  const isOver = enabled && hr != null && hr >= threshold;

  return (
    <div className={`rounded-2xl border p-4 ${isOver ? "bg-red-950/40 border-red-800" : "bg-zinc-900 border-zinc-800"}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-widest text-zinc-500">HR Alert</span>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-white" />
          Enable
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-zinc-400">Max HR
          <input type="number" value={maxHr} onChange={(e) => setMaxHr(parseInt(e.target.value, 10) || 190)} className="mt-1 w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-white" min={120} max={220} />
        </label>
        <label className="text-xs text-zinc-400">Alert ≥ bpm
          <input type="number" value={threshold} onChange={(e) => setThreshold(parseInt(e.target.value, 10) || 175)} className="mt-1 w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-white" min={100} max={220} />
        </label>
      </div>
      {isOver ? <div className="mt-2 text-xs font-semibold text-red-400">⚠ HR {hr} ≥ {threshold} bpm</div> : null}
    </div>
  );
}

export function getStoredMaxHr(): number {
  if (typeof window === "undefined") return 190;
  const v = localStorage.getItem(LS_MAX);
  return v ? parseInt(v, 10) : 190;
}
