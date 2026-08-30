﻿"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MetricCard } from "@/components/MetricCard";
import { LiveChart } from "@/components/LiveChart";
import { LapTrack } from "@/components/LapTrack";
import { HrAlertSettings, getStoredMaxHr } from "@/components/HrAlertSettings";
import { useBluetooth } from "@/hooks/useBluetooth";
import { useRecorder } from "@/hooks/useRecorder";
import { paceMinPerKm, speedKmh } from "@/lib/bleParser";
import { getHrZone } from "@/lib/hrZones";
import { downloadFit } from "@/lib/fitEncoder";
import { ema, HOLD_MS, STATIONARY_SPEED_MS } from "@/lib/smoothing";

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export default function Home() {
  const [hr, setHr] = useState<number | null>(null);
  const [speedMs, setSpeedMs] = useState<number | null>(null);
  const [cadence, setCadence] = useState<number | null>(null);
  const [strideM, setStrideM] = useState<number | null>(null);
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [mock, setMock] = useState(false);
  const [showKmh, setShowKmh] = useState(false);
  const [smoothSpeed, setSmoothSpeed] = useState<number | null>(null);
  const [smoothCadence, setSmoothCadence] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const lastNonZeroSpeedRef = useRef<{ v: number; t: number } | null>(null);
  const lastNonZeroCadRef = useRef<{ v: number; t: number } | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  const recorder = useRecorder();

  const onMetrics = useCallback(
    (m: Partial<{ hr: number | null; speedMs: number | null; cadenceSpm: number | null; strideM: number | null; distanceM: number | null }>) => {
      if (m.hr !== undefined) setHr(m.hr);
      if (m.speedMs !== undefined) {
        setSpeedMs(m.speedMs);
        const nextSpeed = m.speedMs as number | null;
        if (nextSpeed != null && nextSpeed >= STATIONARY_SPEED_MS) {
          lastNonZeroSpeedRef.current = { v: nextSpeed, t: Date.now() };
        }
        setSmoothSpeed((prev) => {
          if (nextSpeed == null) return prev;
          return ema(prev, nextSpeed);
        });
      }
      if (m.cadenceSpm !== undefined) {
        setCadence(m.cadenceSpm);
        const nextCad = m.cadenceSpm as number | null;
        if (nextCad != null && nextCad > 0) {
          lastNonZeroCadRef.current = { v: nextCad, t: Date.now() };
        }
        setSmoothCadence((prev) => {
          if (nextCad == null) return prev;
          return ema(prev, nextCad);
        });
      }
      if (m.strideM !== undefined) setStrideM(m.strideM);
      if (m.distanceM !== undefined) setDistanceM(m.distanceM);
    },
    []
  );

  const bt = useBluetooth(onMetrics);

  // push to recorder every second when recording
  const latestRef = useRef({ hr, cadence, speedMs, distanceM });
  useEffect(() => {
    latestRef.current = { hr, cadence, speedMs, distanceM };
  }, [hr, cadence, speedMs, distanceM]);

  useEffect(() => {
    if (recorder.state !== "recording") return;
    const id = window.setInterval(() => {
      const { hr: h, cadence: c, speedMs: s, distanceM: d } = latestRef.current;
      recorder.pushSample({ hr: h, cadence: c, speedMs: s, distanceM: d });
    }, 1000);
    return () => window.clearInterval(id);
  }, [recorder]);

  // mock mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mock") === "1") setMock(true);
  }, []);

  useEffect(() => {
    if (!mock) return;
    let t = 0;
    const id = window.setInterval(() => {
      t += 1;
      const mHr = 145 + Math.round(10 * Math.sin(t / 10)) + Math.floor(Math.random() * 4);
      const mSpeed = 2.8 + Math.sin(t / 20) * 0.3;
      const mCad = 168 + Math.round(Math.random() * 6 - 3);
      const mStride = 1.1 + Math.random() * 0.1;
      setHr(mHr);
      setSpeedMs(mSpeed);
      setCadence(mCad);
      setStrideM(mStride);
      setDistanceM((prev) => (prev ?? 0) + mSpeed * 1);
      if (recorder.state === "recording") {
        // recorder push handled by interval above, but also ensure distance accumulates
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [mock, recorder.state]);

  const [maxHr, setMaxHrState] = useState(190);
  useEffect(() => { setMaxHrState(getStoredMaxHr()); }, []);
  const zone = getHrZone(hr ?? 0, maxHr);
  const holdSpeed = lastNonZeroSpeedRef.current && now - lastNonZeroSpeedRef.current.t < HOLD_MS ? lastNonZeroSpeedRef.current.v : null;
  const holdCad = lastNonZeroCadRef.current && now - lastNonZeroCadRef.current.t < HOLD_MS ? lastNonZeroCadRef.current.v : null;
  const displaySpeed = smoothSpeed ?? speedMs;
  const displayCad = smoothCadence ?? cadence;
  const isStationary = displaySpeed != null && displaySpeed < STATIONARY_SPEED_MS;
  const isHoldingSpeed = holdSpeed != null && (displaySpeed == null || displaySpeed < STATIONARY_SPEED_MS);
  const isHoldingCad = holdCad != null && (displayCad == null || displayCad === 0);
  const paceSpeed = isHoldingSpeed ? holdSpeed! : displaySpeed;
  const pace = paceSpeed != null && paceSpeed >= STATIONARY_SPEED_MS ? paceMinPerKm(paceSpeed) : isHoldingSpeed ? paceMinPerKm(holdSpeed!) : "--:--";
  const kmhVal = (isHoldingSpeed ? holdSpeed! : displaySpeed) ?? speedMs;
  const kmh = kmhVal != null && kmhVal >= STATIONARY_SPEED_MS ? speedKmh(kmhVal).toFixed(1) : isHoldingSpeed ? speedKmh(holdSpeed!).toFixed(1) : "0.0";
  const cadDisplay = displayCad != null && displayCad > 0 ? String(Math.round(displayCad)) : isHoldingCad ? String(Math.round(holdCad!)) : bt.status === "connected" || mock ? "0" : "--";
  const distKm = distanceM != null ? (distanceM / 1000).toFixed(2) : "0.00";
  const avgPace =
    recorder.records.length && distanceM
      ? paceMinPerKm(distanceM / (recorder.elapsedMs / 1000 || 1))
      : "--:--";
  const avgHr =
    recorder.records.length
      ? Math.round(
          recorder.records.filter((r) => r.heartRate).reduce((a, b) => a + (b.heartRate ?? 0), 0) /
            Math.max(1, recorder.records.filter((r) => r.heartRate).length)
        )
      : null;

  const handleDownload = () => {
    const session = recorder.getSession();
    if (!session || recorder.records.length === 0) return;
    downloadFit(recorder.records, session);
  };

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-black/80 backdrop-blur">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-white text-black grid place-items-center font-black">R</div>
            <span className="font-bold tracking-tight">Runees</span>
            <span className="hidden sm:inline text-xs text-zinc-500">Treadmill Monitor</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${bt.status === "connected" ? "bg-emerald-500" : bt.status === "connecting" ? "bg-amber-500 animate-pulse" : "bg-zinc-600"}`} />
            <span className="text-xs text-zinc-400 hidden sm:inline">
              {bt.status === "connected" ? bt.deviceName || "Connected" : bt.status === "connecting" ? "Connecting..." : "Disconnected"}
            </span>
            {bt.status !== "connected" ? (
              <button
                onClick={bt.connect}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
              >
                Connect Garmin
              </button>
            ) : (
              <button onClick={bt.disconnect} className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900">
                Disconnect
              </button>
            )}
            <label className="ml-2 flex items-center gap-1 text-xs text-zinc-400">
              <input type="checkbox" checked={mock} onChange={(e) => setMock(e.target.checked)} className="accent-white" /> Mock
            </label>
          </div>
        </div>
        {bt.error ? <div className="mx-auto max-w-6xl px-4 pb-2 text-xs text-amber-400">{bt.error}</div> : null}
        {!bt.isSupported ? (
          <div className="mx-auto max-w-6xl px-4 pb-2 text-xs text-red-400">Web Bluetooth not supported. Use Chrome or Edge on Windows. For localhost, use http://localhost:3000</div>
        ) : null}
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400">
          On watch: <span className="text-zinc-200">Hold Menu &gt; Sensors &gt; Virtual Run</span> then start. Keep this tab in foreground. Pace/cadence require Virtual Run (not Broadcast HR).
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard
            label={`Heart Rate ${zone ? `· ${zone.label}` : ""}`}
            value={hr != null ? String(hr) : "--"}
            unit="bpm"
            sub={zone ? `${zone.label}` : "Connect to see HR"}
            colorClass={zone?.color || "text-white"}
          />
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-6 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs tracking-widest text-zinc-500 uppercase">Pace</span>
              <button onClick={() => setShowKmh((v) => !v)} className="text-xs text-zinc-400 underline">
                {showKmh ? "Show min/km" : "Show km/h"}
              </button>
            </div>
            <div className="text-5xl font-black tabular-nums text-white">
              {showKmh ? (
                <>
                  {kmh} <span className="text-xl font-semibold text-zinc-400">km/h</span>
                </>
              ) : (
                <>
                  {pace} <span className="text-xl font-semibold text-zinc-400">/km</span>
                </>
              )}
            </div>
            <div className="text-sm text-zinc-400">{showKmh ? `Pace ${pace} /km` : `${kmh} km/h`} · Stride {strideM != null ? strideM.toFixed(2) : "--"} m {isStationary ? "· Stationary" : isHoldingSpeed ? "· Holding" : ""}</div>
          </div>
          <MetricCard label="Cadence" value={cadDisplay} unit="spm" sub={`${strideM != null ? `Stride ${strideM.toFixed(2)} m` : "Steps per minute"}${isHoldingCad ? " · Holding" : isStationary ? " · Stationary" : ""}`} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4">
            <div className="text-xs text-zinc-500 uppercase tracking-widest">Time</div>
            <div className="text-3xl font-mono font-bold tabular-nums">{formatTime(recorder.elapsedMs)}</div>
            <div className="text-xs text-zinc-500 capitalize">{recorder.state}</div>
          </div>
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4">
            <div className="text-xs text-zinc-500 uppercase tracking-widest">Distance</div>
            <div className="text-3xl font-bold tabular-nums">{distKm} <span className="text-base text-zinc-400">km</span></div>
            <div className="text-xs text-zinc-500">From Garmin RSC</div>
          </div>
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4">
            <div className="text-xs text-zinc-500 uppercase tracking-widest">Avg Pace</div>
            <div className="text-3xl font-bold tabular-nums">{avgPace}</div>
            <div className="text-xs text-zinc-500">Avg HR {avgHr ?? "--"} bpm</div>
          </div>
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 flex flex-col justify-center gap-2">
            <div className="text-xs text-zinc-500 uppercase tracking-widest">Session</div>
            <div className="flex flex-wrap gap-2">
              {recorder.state === "idle" && (
                <button onClick={recorder.start} className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold hover:bg-emerald-500">Start</button>
              )}
              {recorder.state === "recording" && (
                <>
                  <button onClick={recorder.pause} className="rounded-full bg-amber-600 px-5 py-2 text-sm font-semibold hover:bg-amber-500">Pause</button>
                  <button onClick={recorder.stop} className="rounded-full bg-zinc-800 border border-zinc-700 px-5 py-2 text-sm font-semibold hover:bg-zinc-700">Stop</button>
                </>
              )}
              {recorder.state === "paused" && (
                <>
                  <button onClick={recorder.resume} className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold hover:bg-emerald-500">Resume</button>
                  <button onClick={recorder.stop} className="rounded-full bg-zinc-800 border border-zinc-700 px-5 py-2 text-sm font-semibold hover:bg-zinc-700">Stop</button>
                </>
              )}
              {recorder.state === "stopped" && (
                <>
                  <button onClick={handleDownload} className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-zinc-200">Download .FIT</button>
                  <button onClick={recorder.reset} className="rounded-full border border-zinc-700 px-5 py-2 text-sm hover:bg-zinc-900">Reset</button>
                </>
              )}
            </div>
            <div className="text-xs text-zinc-500">{recorder.records.length} samples · {recorder.state === "stopped" ? "Ready to import to Garmin Connect" : "1 Hz recording"}</div>
          </div>
        </div>

        {recorder.state === "stopped" && recorder.records.length > 0 ? (
          <div className="rounded-2xl border border-emerald-900 bg-emerald-950/30 p-4 text-sm text-emerald-200">
            Session saved in memory. Click <span className="font-semibold">Download .FIT</span> and import at <a className="underline" href="https://connect.garmin.com/modern/import-data" target="_blank" rel="noreferrer">Garmin Connect Import</a>. Validate at fitfileviewer.com if needed.
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-2xl bg-zinc-900 border border-zinc-800 p-4">
            <div className="text-xs uppercase tracking-widest text-zinc-500 mb-2">Live Chart · HR / Cadence / km/h</div>
            <LiveChart records={recorder.records} />
          </div>
          <div className="space-y-4">
            <LapTrack distanceM={distanceM} />
            <HrAlertSettings hr={hr} />
          </div>
        </div>

        {recorder.getLaps().length > 0 ? (
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4">
            <div className="text-xs uppercase tracking-widest text-zinc-500 mb-2">Auto-laps · 1 km</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr><th className="text-left py-1">Lap</th><th className="text-right">Dist</th><th className="text-right">Time</th><th className="text-right">Pace</th><th className="text-right">Avg HR</th></tr>
                </thead>
                <tbody>
                  {recorder.getLaps().map((lap) => {
                    const secs = (lap.endTime.getTime() - lap.startTime.getTime()) / 1000;
                    const pace = secs > 0 && lap.distanceM > 0 ? paceMinPerKm(lap.distanceM / secs) : "--:--";
                    const avgHr = lap.records.filter((r) => r.heartRate).length ? Math.round(lap.records.filter((r) => r.heartRate).reduce((a, b) => a + (b.heartRate ?? 0), 0) / Math.max(1, lap.records.filter((r) => r.heartRate).length)) : "--";
                    return (
                      <tr key={lap.index} className="border-t border-zinc-800">
                        <td className="py-1">{lap.index + 1}</td>
                        <td className="text-right">{(lap.distanceM / 1000).toFixed(2)} km</td>
                        <td className="text-right">{formatTime(lap.endTime.getTime() - lap.startTime.getTime())}</td>
                        <td className="text-right">{pace} /km</td>
                        <td className="text-right">{avgHr}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <details className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <summary className="cursor-pointer text-sm font-semibold">Help & Troubleshooting</summary>
          <ul className="mt-2 list-disc pl-5 text-sm text-zinc-400 space-y-1">
            <li>Use Chrome or Edge. Firefox/Safari do not support Web Bluetooth.</li>
            <li>Open via <code className="text-zinc-200">http://localhost:3000</code> · secure context required. <code>http://192.168.x.x</code> will fail.</li>
            <li>On Forerunner: Virtual Run broadcasts HR + pace/cadence. Broadcast HR alone gives only HR.</li>
            <li>If no RSC: check watch is in Virtual Run, not just Broadcast HR.</li>
            <li>Keep tab foreground; background tabs may throttle BLE.</li>
            <li>Mock toggle simulates data for UI testing without watch.</li>
          </ul>
        </details>
      </div>
    </main>
  );
}
