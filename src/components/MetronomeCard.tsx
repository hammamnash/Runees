"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { metronomeStore } from "@/lib/metronomeStore";

const LS_TARGET = "runees_metronomeTarget";
const LS_VOLUME = "runees_metronomeVolume";

const PRESETS = [160, 170, 175, 180];

// Deviation thresholds (spm) for coaching feedback vs live cadence.
const DEV_OK = 2;
const DEV_WARN = 6;

function readStoredNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(key);
  if (v == null) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function readStoredFloat(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(key);
  if (v == null) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampTarget(n: number): number {
  if (!Number.isFinite(n)) return 180;
  return Math.min(250, Math.max(120, Math.round(n)));
}

export function MetronomeCard({ liveCadence }: { liveCadence: number | null }) {
  // Engine lives in metronomeStore (module scope) so cues keep playing even if
  // this card unmounts — e.g. when the Settings section is collapsed.
  const meta = useSyncExternalStore(
    metronomeStore.subscribe,
    metronomeStore.getSnapshot,
    metronomeStore.getServerSnapshot
  );
  const running = meta.running;
  const activeBeat = meta.beatIndex;

  const [target, setTarget] = useState(180);
  const [volume, setVolume] = useState(0.8);

  // Hydrate persisted settings (client-only).
  useEffect(() => {
    setTarget(clampTarget(readStoredNumber(LS_TARGET, 180)));
    setVolume(readStoredFloat(LS_VOLUME, 0.8));
  }, []);

  const persistTarget = useCallback((v: number) => {
    if (typeof window !== "undefined") window.localStorage.setItem(LS_TARGET, String(v));
  }, []);

  const persistVolume = useCallback((v: number) => {
    if (typeof window !== "undefined") window.localStorage.setItem(LS_VOLUME, String(v));
  }, []);

  const handleToggle = useCallback(() => {
    if (running) {
      metronomeStore.stop();
      return;
    }
    metronomeStore.start(target, volume);
  }, [running, target, volume]);

  const adjustTarget = useCallback(
    (delta: number) => {
      setTarget((prev) => {
        const next = clampTarget(prev + delta);
        persistTarget(next);
        return next;
      });
    },
    [persistTarget]
  );

  const handleInput = useCallback(
    (raw: string) => {
      const n = parseInt(raw, 10);
      const next = Number.isFinite(n) ? clampTarget(n) : 180;
      setTarget(next);
      persistTarget(next);
    },
    [persistTarget]
  );

  // Deviation feedback vs live cadence (only meaningful while running).
  const dev = running && liveCadence != null && liveCadence > 0 ? liveCadence - target : null;
  let feedback: { text: string; color: string } | null = null;
  if (dev != null) {
    const ad = Math.abs(dev);
    if (ad <= DEV_OK) {
      feedback = { text: "On target", color: "text-emerald-400" };
    } else if (ad <= DEV_WARN) {
      feedback =
        dev < 0
          ? { text: "Slightly slow — lengthen stride", color: "text-saffron" }
          : { text: "Slightly fast — ease off", color: "text-saffron" };
    } else {
      feedback =
        dev < 0
          ? { text: "Too slow — shorten stride, quicken steps", color: "text-red-400" }
          : { text: "Too fast — lengthen stride, slow steps", color: "text-red-400" };
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="eyebrow !text-ash">Metronome</span>
        {running ? (
          <span className="flex items-center gap-1.5 text-xs text-iris">
            <span className="h-2 w-2 animate-pulse rounded-full bg-iris" /> Cuing
          </span>
        ) : null}
      </div>

      {/* Beat indicator dots — pulse with the accent cycle (4 beats/bar) */}
      <div className="flex items-center gap-2" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-2.5 w-2.5 rounded-full transition-all duration-100 ${
              running && activeBeat === i
                ? i === 0
                  ? "scale-125 bg-iris"
                  : "scale-110 bg-mist"
                : "bg-white/15"
            }`}
          />
        ))}
      </div>

      {/* Target cadence control */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => adjustTarget(-1)}
          className="ghost-pill !px-3 !py-1.5"
          aria-label="Decrease target cadence"
          disabled={running}
        >
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          value={target}
          onChange={(e) => handleInput(e.target.value)}
          disabled={running}
          min={120}
          max={250}
          className="metric-num w-20 rounded-card bg-white/5 px-3 py-2 text-center text-3xl text-white outline-none transition focus:bg-white/10 disabled:opacity-60"
        />
        <button
          onClick={() => adjustTarget(1)}
          className="ghost-pill !px-3 !py-1.5"
          aria-label="Increase target cadence"
          disabled={running}
        >
          +
        </button>
        <span className="text-sm font-light text-ash">spm</span>
      </div>

      {/* Presets (disabled while running — engine bpm is locked to target) */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => {
              setTarget(p);
              persistTarget(p);
            }}
            disabled={running}
            className={`rounded-pill border px-3 py-1 text-xs transition disabled:opacity-40 ${
              target === p
                ? "border-iris bg-iris/20 text-white"
                : "border-white/10 text-ash hover:border-white/30 hover:text-white"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Start / Stop */}
      <div className="flex items-center gap-3">
        <button onClick={handleToggle} className={running ? "ghost-pill" : "iris-pill"}>
          {running ? "Stop" : "Start"}
        </button>
        <label className="flex flex-1 items-center gap-2 text-xs font-light text-ash">
          Vol
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setVolume(v);
              persistVolume(v);
              metronomeStore.setVolume(v);
            }}
            className="flex-1 accent-[#8052ff]"
          />
        </label>
      </div>

      {/* Live deviation coaching line */}
      <div className="text-xs font-light">
        {running ? (
          feedback ? (
            <span className={feedback.color}>{feedback.text}</span>
          ) : (
            <span className="text-ash">Waiting for live cadence…</span>
          )
        ) : (
          <span className="text-ash">
            Target locked while cuing. {liveCadence != null && liveCadence > 0 ? `Live: ${Math.round(liveCadence)} spm` : "Connect foot pod for live cadence."}
          </span>
        )}
      </div>
    </div>
  );
}
