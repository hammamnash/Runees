"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { hrZoneStore } from "@/lib/hrZoneStore";
import { getAllZones, getZoneRange, HrZoneConfig } from "@/lib/hrZones";

// Keep the previous exported helper API for backward compatibility with callers
// that read the stored max HR directly (imported from this module).
const LS_MAX = "runees_maxHr";
const LS_ALERT = "runees_hrAlert";
const LS_ENABLED = "runees_hrAlertEnabled";

export function HrAlertSettings({ hr }: { hr: number | null }) {
  const settings = useSyncExternalStore(
    hrZoneStore.subscribe,
    hrZoneStore.getSnapshot,
    hrZoneStore.getServerSnapshot
  );
  const lastAlertRef = useRef(0);

  const cfg: HrZoneConfig = {
    method: settings.method,
    maxHr: settings.maxHr,
    restingHr: settings.restingHr,
  };

  // Alert audio/vibration
  useEffect(() => {
    if (!settings.alertEnabled || hr == null) return;
    if (hr >= settings.alertThreshold && Date.now() - lastAlertRef.current > 10000) {
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
  }, [hr, settings.alertThreshold, settings.alertEnabled]);

  const isOver = settings.alertEnabled && hr != null && hr >= settings.alertThreshold;

  const zones = getAllZones(cfg);
  const currentZone = hr != null && hr > 0 ? zones.findIndex((z) => {
    const r = getZoneRange(z, cfg);
    return hr >= r.low && hr < r.high;
  }) : -1;

  const setMax = (v: string) => hrZoneStore.setMaxHr(parseInt(v, 10) || 190);
  const setRest = (v: string) => hrZoneStore.setRestingHr(parseInt(v, 10) || 76);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <span className="eyebrow !text-ash">HR Zones</span>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-ash transition-colors hover:text-white">
          <input type="checkbox" checked={settings.alertEnabled} onChange={(e) => hrZoneStore.setAlertEnabled(e.target.checked)} className="accent-[#8052ff]" />
          Alert
        </label>
      </div>

      {/* Method toggle */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-card bg-white/5 p-1">
        {(
          [
            { key: "max", label: "HRMax" },
            { key: "hrr", label: "HRR (Karvonen)" },
          ] as const
        ).map((m) => (
          <button
            key={m.key}
            onClick={() => hrZoneStore.setMethod(m.key)}
            className={`rounded-pill px-2 py-1.5 text-xs font-medium transition ${
              settings.method === m.key ? "bg-iris text-white" : "text-ash hover:text-white"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-2 gap-4">
        <label className="text-xs font-light text-ash">Max HR
          <input
            type="number"
            value={settings.maxHr}
            onChange={(e) => setMax(e.target.value)}
            className="mt-1 w-full rounded-card bg-white/5 px-3 py-2 text-white outline-none transition focus:bg-white/10"
            min={120}
            max={220}
          />
          <span className="mt-0.5 block text-[10px] text-zinc-600">Tip: 220 − age</span>
        </label>
        {settings.method === "hrr" ? (
          <label className="text-xs font-light text-ash">Resting HR
            <input
              type="number"
              value={settings.restingHr}
              onChange={(e) => setRest(e.target.value)}
              className="mt-1 w-full rounded-card bg-white/5 px-3 py-2 text-white outline-none transition focus:bg-white/10"
              min={35}
              max={120}
            />
            <span className="mt-0.5 block text-[10px] text-zinc-600">Waking, seated</span>
          </label>
        ) : (
          <label className="text-xs font-light text-ash">Alert ≥ bpm
            <input
              type="number"
              value={settings.alertThreshold}
              onChange={(e) => hrZoneStore.setAlertThreshold(parseInt(e.target.value, 10) || 175)}
              className="mt-1 w-full rounded-card bg-white/5 px-3 py-2 text-white outline-none transition focus:bg-white/10"
              min={100}
              max={220}
            />
          </label>
        )}
      </div>

      {settings.method === "hrr" ? (
        <label className="mt-4 block text-xs font-light text-ash">Alert ≥ bpm
          <input
            type="number"
            value={settings.alertThreshold}
            onChange={(e) => hrZoneStore.setAlertThreshold(parseInt(e.target.value, 10) || 175)}
            className="mt-1 w-full rounded-card bg-white/5 px-3 py-2 text-white outline-none transition focus:bg-white/10"
            min={100}
            max={220}
          />
        </label>
      ) : null}

      {isOver ? <div className="mt-3 text-xs font-semibold text-red-400">⚠ HR {hr} ≥ {settings.alertThreshold} bpm</div> : null}

      {/* Zone table */}
      <div className="mt-5">
        <div className="mb-2 text-[10px] uppercase tracking-nav text-zinc-600">Zones</div>
        <div className="space-y-1.5">
          {zones.map((z, i) => {
            const r = getZoneRange(z, cfg);
            const active = i === currentZone;
            return (
              <div
                key={z.zone}
                className={`flex items-center justify-between rounded-card px-3 py-1.5 text-xs transition ${
                  active ? "bg-white/10 text-white" : "text-ash"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${z.bg}`} />
                  {z.label}
                </span>
                <span className="tabular-nums">
                  {r.low}–{r.high} bpm
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function getStoredMaxHr(): number {
  if (typeof window === "undefined") return 190;
  const v = localStorage.getItem(LS_MAX);
  return v ? parseInt(v, 10) : 190;
}

export function getStoredAlertSettings(): { threshold: number; enabled: boolean } {
  if (typeof window === "undefined") return { threshold: 175, enabled: false };
  const t = localStorage.getItem(LS_ALERT);
  const e = localStorage.getItem(LS_ENABLED);
  return { threshold: t ? parseInt(t, 10) : 175, enabled: e === "1" };
}
