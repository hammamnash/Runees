﻿"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MetricCard } from "@/components/MetricCard";
import { ClockCard } from "@/components/ClockCard";
import { LiveChart } from "@/components/LiveChart";
import { LapTrack } from "@/components/LapTrack";
import { HrAlertSettings, getStoredMaxHr } from "@/components/HrAlertSettings";
import { useBleSource } from "@/hooks/useBleSource";
import { useRecorder } from "@/hooks/useRecorder";
import { paceMinPerKm, speedKmh } from "@/lib/bleParser";
import { getHrZone } from "@/lib/hrZones";
import { downloadFit } from "@/lib/fitEncoder";
import { ema, HOLD_MS, STATIONARY_SPEED_MS } from "@/lib/smoothing";
import { assignSource, disconnectDevice, pickDevice, poolStore } from "@/lib/bleDevicePool";

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
  const [devicesOpen, setDevicesOpen] = useState(true);
  const lastNonZeroSpeedRef = useRef<{ v: number; t: number } | null>(null);
  const lastNonZeroCadRef = useRef<{ v: number; t: number } | null>(null);
  const lastRscTimeRef = useRef<number | null>(null);
  const hasGarminDistanceRef = useRef(false);
  const distanceAtStartRef = useRef<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  const recorder = useRecorder();

  // HR priority: strap (heartrate slot) wins; footpod HR is fallback after 5s without strap HR
  const lastHrFromStrapRef = useRef<number>(0);
  const lastHrFromFootpodRef = useRef<number | null>(null);

  const onFootpodMetrics = useCallback(
    (m: Partial<{ hr: number | null; speedMs: number | null; cadence: number | null; strideM: number | null; distanceM: number | null; isRunning: boolean | null }>) => {
      // HR from footpod only if strap hasn't sent HR recently (5s fallback)
      if (m.hr !== undefined && m.hr != null) {
        lastHrFromFootpodRef.current = m.hr;
        const strapFresh = Date.now() - lastHrFromStrapRef.current < 5000;
        if (!strapFresh) setHr(m.hr);
      }
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
      if (m.cadence !== undefined) {
        const nextCad = m.cadence as number | null;
        setCadence(nextCad ?? null);
        if (nextCad != null && nextCad > 0) {
          lastNonZeroCadRef.current = { v: nextCad, t: Date.now() };
        }
        setSmoothCadence((prev) => {
          if (nextCad == null) return prev;
          return ema(prev, nextCad);
        });
      }
      if (m.strideM !== undefined) setStrideM(m.strideM);
      if (m.distanceM !== undefined) {
        if (m.distanceM != null) {
          hasGarminDistanceRef.current = true;
          lastRscTimeRef.current = Date.now();
          setDistanceM(m.distanceM);
        } else if (!hasGarminDistanceRef.current) {
          const now = Date.now();
          const last = lastRscTimeRef.current;
          const dt = last ? (now - last) / 1000 : 1;
          lastRscTimeRef.current = now;
          const curSpeed = m.speedMs as number | null;
          if (curSpeed != null && curSpeed >= STATIONARY_SPEED_MS) {
            const add = curSpeed * Math.min(Math.max(dt, 0.2), 2);
            setDistanceM((prev) => (prev ?? 0) + add);
          }
        }
      }
    },
    []
  );

  const onHrMetrics = useCallback(
    (m: Partial<{ hr: number | null }>) => {
      if (m.hr !== undefined && m.hr != null) {
        lastHrFromStrapRef.current = Date.now();
        setHr(m.hr);
      }
    },
    []
  );

  const footpod = useBleSource("footpod", onFootpodMetrics);
  const heartrate = useBleSource("heartrate", onHrMetrics);

  // Subscribe to the device-pool store so this page re-renders as devices connect/disconnect.
  const pool = useSyncExternalStore(poolStore.subscribe, poolStore.getSnapshot, poolStore.getServerSnapshot);

  const handleAddDevice = useCallback(async () => {
    await pickDevice();
  }, []);

  const handleDisconnectDevice = useCallback((id: string | null) => {
    disconnectDevice(id);
  }, []);

  const handleAssignSource = useCallback((slot: "footpod" | "heartrate", id: string | null) => {
    assignSource(slot, id);
  }, []);

  // Derived HR card state: if footpod (watch) is connected it also provides HR,
  // so HR section should show as connected via shared device until a dedicated strap is chosen.
  const hrIsDedicated = heartrate.status === "connected";
  const hrIsShared = !hrIsDedicated && heartrate.status !== "connecting" && footpod.status === "connected";
  const hrCardStatus = hrIsDedicated ? heartrate.status : hrIsShared ? "connected" as const : heartrate.status;
  const hrCardName = hrIsDedicated ? heartrate.deviceName : hrIsShared ? footpod.deviceName : heartrate.deviceName;
  const hrCardBattery = hrIsDedicated ? heartrate.batteryPct : hrIsShared ? footpod.batteryPct : heartrate.batteryPct;
  const hrCardInfo = hrIsDedicated ? heartrate.deviceInfo : hrIsShared ? footpod.deviceInfo : heartrate.deviceInfo;

  // Fallback: if strap disconnects, periodically check if footpod HR should take over
  useEffect(() => {
    const id = window.setInterval(() => {
      if (heartrate.status !== "connected" && lastHrFromFootpodRef.current != null) {
        const strapFresh = Date.now() - lastHrFromStrapRef.current < 5000;
        if (!strapFresh) setHr(lastHrFromFootpodRef.current);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [heartrate.status]);

  // push to recorder every second when recording
  const latestRef = useRef({ hr, cadence, speedMs, distanceM });
  useEffect(() => {
    latestRef.current = { hr, cadence, speedMs, distanceM };
  }, [hr, cadence, speedMs, distanceM]);

  useEffect(() => {
    if (recorder.state !== "recording") return;
    const id = window.setInterval(() => {
      const { hr: h, cadence: c, speedMs: s } = latestRef.current;
      const raw = latestRef.current.distanceM ?? 0;
      const base = distanceAtStartRef.current ?? 0;
      const sessionD = Math.max(0, raw - base);
      recorder.pushSample({ hr: h, cadence: c, speedMs: s, distanceM: sessionD });
    }, 1000);
    return () => window.clearInterval(id);
  }, [recorder.state, recorder.pushSample]);

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
  const footpodConnected = footpod.status === "connected" || mock;
  const pace =
    paceSpeed != null && paceSpeed >= STATIONARY_SPEED_MS
      ? paceMinPerKm(paceSpeed)
      : isHoldingSpeed
        ? paceMinPerKm(holdSpeed!)
        : footpodConnected
          ? "00:00"
          : "--:--";
  const kmhVal = (isHoldingSpeed ? holdSpeed! : displaySpeed) ?? speedMs;
  const kmh =
    kmhVal != null && kmhVal >= STATIONARY_SPEED_MS
      ? speedKmh(kmhVal).toFixed(1)
      : isHoldingSpeed
        ? speedKmh(holdSpeed!).toFixed(1)
        : footpodConnected
          ? "0.0"
          : "--";
  const cadDisplay = displayCad != null && displayCad > 0 ? String(Math.round(displayCad)) : isHoldingCad ? String(Math.round(holdCad!)) : footpod.status === "connected" || mock ? "0" : "--";
  // Session distance: delta from distance at Start (0 when idle). Keeps raw distanceM for live HR/Pace/Cadence.
  const sessionDistanceM = recorder.state === "idle" ? 0 : Math.max(0, (distanceM ?? 0) - (distanceAtStartRef.current ?? 0));
  const distKm = (sessionDistanceM / 1000).toFixed(2);
  // Avg pace from the last pushed sample (1Hz): distance at sample time ÷ sample count (seconds).
  // Derived from records instead of live elapsedMs so it updates uniformly with the other session metrics.
  const lastRec = recorder.records[recorder.records.length - 1];
  const avgPace =
    lastRec?.distanceM != null && lastRec.distanceM > 0
      ? paceMinPerKm(lastRec.distanceM / Math.max(1, recorder.records.length))
      : "--:--";
  const avgHr =
    recorder.records.length
      ? Math.round(
          recorder.records.filter((r) => r.heartRate).reduce((a, b) => a + (b.heartRate ?? 0), 0) /
            Math.max(1, recorder.records.filter((r) => r.heartRate).length)
        )
      : null;
  const avgHrZone = avgHr != null ? getHrZone(avgHr, maxHr) : null;

  const handleStart = useCallback(() => {
    distanceAtStartRef.current = distanceM ?? 0;
    recorder.start();
  }, [distanceM, recorder]);

  const handleReset = useCallback(() => {
    distanceAtStartRef.current = null;
    recorder.reset();
  }, [recorder]);

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
            <label className="flex items-center gap-1 text-xs text-zinc-400">
              <input type="checkbox" checked={mock} onChange={(e) => setMock(e.target.checked)} className="accent-white" /> Mock
            </label>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400">
          On watch: <span className="text-zinc-200">Hold Menu &gt; Sensors &gt; Virtual Run</span> then start. Keep this tab in foreground. Pace/cadence require Virtual Run (not Broadcast HR).
        </div>

        {/* Devices + Source Assignment — connect device(s) once, then assign each source */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-3">
            <button
              onClick={() => setDevicesOpen((v) => !v)}
              className="flex items-center gap-3 text-left min-w-0"
              aria-expanded={devicesOpen}
            >
              <h2 className="text-sm font-bold tracking-widest text-white uppercase">Devices</h2>
              {!devicesOpen ? (
                <span className="flex flex-wrap items-center gap-3 text-xs text-zinc-400 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${footpod.status === "connected" ? "bg-emerald-500" : footpod.status === "connecting" ? "bg-amber-500 animate-pulse" : "bg-zinc-600"}`} />
                    Foot Pod: {pool.assignments.footpod ? (pool.devices.find((d) => d.id === pool.assignments.footpod)?.name || pool.assignments.footpod) : "—"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${hrCardStatus === "connected" ? "bg-emerald-500" : hrCardStatus === "connecting" ? "bg-amber-500 animate-pulse" : "bg-zinc-600"}`} />
                    HR: {pool.assignments.heartrate ? (pool.devices.find((d) => d.id === pool.assignments.heartrate)?.name || pool.assignments.heartrate) : "—"}
                  </span>
                </span>
              ) : null}
            </button>
            <div className="flex items-center gap-3 shrink-0">
              {devicesOpen ? (
                <button
                  onClick={handleAddDevice}
                  className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
                >
                  Connect Device
                </button>
              ) : null}
              <button
                onClick={() => setDevicesOpen((v) => !v)}
                aria-expanded={devicesOpen}
                aria-label={devicesOpen ? "Collapse devices" : "Expand devices"}
              >
                <svg
                  className={`h-4 w-4 text-zinc-500 transition-transform ${devicesOpen ? "rotate-180" : ""}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden
                >
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>

          {devicesOpen ? (
            <>
          {/* Connected Devices pool */}
          <div className="p-4 space-y-2">
            {pool.devices.length === 0 ? (
              <div className="text-xs text-zinc-500">No devices connected. Click <span className="text-zinc-300">Connect Device</span> to open the browser BLE picker.</div>
            ) : (
              pool.devices.map((d) => {
                const isFoot = pool.assignments.footpod === d.id;
                const isHr = pool.assignments.heartrate === d.id;
                return (
                  <div key={d.id} className="rounded-xl bg-black/40 border border-zinc-800 p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`h-2 w-2 rounded-full ${d.status === "connected" ? "bg-emerald-500" : d.status === "connecting" ? "bg-amber-500 animate-pulse" : d.status === "error" ? "bg-red-500" : "bg-zinc-600"}`} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{d.name || d.id}</div>
                        <div className="text-xs text-zinc-500">
                          {d.status === "connected" ? "Connected" : d.status === "connecting" ? "Connecting..." : d.status === "error" ? "Error" : "Disconnected"}
                          {d.batteryPct != null ? ` • ${d.batteryPct}%` : ""}
                          {d.deviceInfo?.model ? ` • ${d.deviceInfo.model}` : ""}
                        </div>
                        {d.error ? <div className="text-xs text-amber-400">{d.error}</div> : null}
                        {isFoot || isHr ? (
                          <div className="text-xs text-zinc-400 mt-0.5">
                            → {[isFoot ? "Foot Pod" : null, isHr ? "Heart Rate" : null].filter(Boolean).join(" + ")}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <button onClick={() => handleDisconnectDevice(d.id)} className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900">
                      Disconnect
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Per-source assignment dropdowns */}
          <div className="border-t border-zinc-800 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl bg-black/40 border border-zinc-800 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${footpod.status === "connected" ? "bg-emerald-500" : footpod.status === "connecting" ? "bg-amber-500 animate-pulse" : "bg-zinc-600"}`} />
                  <span className="text-sm font-semibold text-white">Foot Pod</span>
                  <span className="text-xs text-zinc-500">RSC • pace/cadence/distance</span>
                </div>
              </div>
              <select
                className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white"
                value={pool.assignments.footpod ?? ""}
                onChange={(e) => handleAssignSource("footpod", e.target.value || null)}
              >
                <option value="">— Unassigned —</option>
                {pool.devices.map((d) => (
                  <option key={d.id} value={d.id ?? ""}>{d.name || d.id}</option>
                ))}
              </select>
              {footpod.error ? <div className="text-xs text-amber-400">{footpod.error}</div> : null}
              {footpod.isSupported === false ? <div className="text-xs text-red-400">Web Bluetooth not supported. Use Chrome/Edge.</div> : null}
            </div>

            <div className="rounded-xl bg-black/40 border border-zinc-800 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${hrCardStatus === "connected" ? "bg-emerald-500" : hrCardStatus === "connecting" ? "bg-amber-500 animate-pulse" : "bg-zinc-600"}`} />
                  <span className="text-sm font-semibold text-white">Heart Rate</span>
                  <span className="text-xs text-zinc-500">HR</span>
                </div>
              </div>
              <select
                className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white"
                value={pool.assignments.heartrate ?? ""}
                onChange={(e) => handleAssignSource("heartrate", e.target.value || null)}
              >
                <option value="">— Unassigned —</option>
                {pool.devices.map((d) => (
                  <option key={d.id} value={d.id ?? ""}>{d.name || d.id}</option>
                ))}
              </select>
              {hrIsShared ? <div className="text-xs text-zinc-500">Using watch HR. Assign a dedicated device for more accurate HR.</div> : null}
              {heartrate.error ? <div className="text-xs text-amber-400">{heartrate.error}</div> : null}
              {heartrate.isSupported === false ? <div className="text-xs text-red-400">Web Bluetooth not supported. Use Chrome/Edge.</div> : null}
            </div>
          </div>
            </>
          ) : null}
        </section>

        <ClockCard />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard
            label={`Heart Rate ${zone ? `• ${zone.label}` : ""}`}
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
            <div className="text-sm text-zinc-400">{showKmh ? `Pace ${pace} /km` : `${kmh} km/h`} • Stride {strideM != null ? strideM.toFixed(2) : "--"} m</div>
          </div>
          <MetricCard label="Cadence" value={cadDisplay} unit="spm" sub={`${strideM != null ? `Stride ${strideM.toFixed(2)} m` : "Steps per minute"}${isHoldingCad ? " · Holding" : isStationary ? " · Stationary" : ""}`} />
        </div>

        {/* Session Box — unified: header + metrics + chart/track. Distance/chart/track only count after Start */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
          {/* Session header: Start at top */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-bold tracking-widest text-white uppercase">Session</h2>
              <span className={`h-2 w-2 rounded-full ${recorder.state === "recording" ? "bg-emerald-500 animate-pulse" : recorder.state === "paused" ? "bg-amber-500" : recorder.state === "stopped" ? "bg-zinc-500" : "bg-zinc-600"}`} />
              <span className="text-xs font-mono tabular-nums text-zinc-400">{formatTime(recorder.elapsedMs)}</span>
              <span className="hidden sm:inline text-xs capitalize text-zinc-500">· {recorder.state}</span>
              <span className="text-xs text-zinc-500">{recorder.records.length} samples</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {recorder.state === "idle" && (
                <button onClick={handleStart} className="rounded-full bg-emerald-600 px-6 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Start</button>
              )}
              {recorder.state === "recording" && (
                <>
                  <button onClick={recorder.pause} className="rounded-full bg-amber-600 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-500">Pause</button>
                  <button onClick={recorder.stop} className="rounded-full border border-zinc-700 bg-zinc-800 px-5 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-700">Stop</button>
                </>
              )}
              {recorder.state === "paused" && (
                <>
                  <button onClick={recorder.resume} className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Resume</button>
                  <button onClick={recorder.stop} className="rounded-full border border-zinc-700 bg-zinc-800 px-5 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-700">Stop</button>
                </>
              )}
              {recorder.state === "stopped" && (
                <>
                  <button onClick={handleDownload} className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-zinc-200">Download .FIT</button>
                  <button onClick={handleReset} className="rounded-full border border-zinc-700 px-5 py-2 text-sm text-zinc-300 hover:bg-zinc-800">Reset</button>
                </>
              )}
            </div>
          </div>

          {recorder.state === "idle" ? (
            <div className="px-4 py-3 text-xs text-zinc-500 sm:px-5">Press <span className="font-semibold text-zinc-300">Start</span> to begin recording. Distance, chart and track will stay at zero until then.</div>
          ) : null}

          {/* Session metrics — sessionDistanceM / avgPace / avgHr only meaningful after Start */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 sm:p-5">
            <div className="rounded-xl bg-black/40 border border-zinc-800 p-4">
              <div className="text-xs text-zinc-500 uppercase tracking-widest">Time</div>
              <div className="text-3xl font-mono font-bold tabular-nums text-white">{formatTime(recorder.elapsedMs)}</div>
              <div className="text-xs capitalize text-zinc-500">{recorder.state} · 1 Hz</div>
            </div>
            <div className="rounded-xl bg-black/40 border border-zinc-800 p-4">
              <div className="text-xs text-zinc-500 uppercase tracking-widest">Distance</div>
              <div className="text-3xl font-bold tabular-nums text-white">{distKm} <span className="text-base font-normal text-zinc-400">km</span></div>
              <div className="text-xs text-zinc-500">Session total</div>
            </div>
            <div className="rounded-xl bg-black/40 border border-zinc-800 p-4">
              <div className="text-xs text-zinc-500 uppercase tracking-widest">Avg Pace</div>
              <div className="text-3xl font-bold tabular-nums text-white">{avgPace} <span className="text-base font-normal text-zinc-400">/km</span></div>
              <div className="text-xs text-zinc-500">{recorder.records.length ? `${(sessionDistanceM / 1000).toFixed(2)} km` : "—"}</div>
            </div>
            <div className="rounded-xl bg-black/40 border border-zinc-800 p-4">
              <div className="text-xs text-zinc-500 uppercase tracking-widest">Avg HR {avgHrZone ? `• ${avgHrZone.label}` : ""}</div>
              <div className={`text-3xl font-bold tabular-nums ${avgHrZone?.color || "text-white"}`}>{avgHr != null ? avgHr : "--"} <span className="text-base font-normal text-zinc-400">bpm</span></div>
              <div className="text-xs text-zinc-500">{avgHrZone ? avgHrZone.label : recorder.records.length ? "No HR samples yet" : "—"}</div>
            </div>
          </div>

          {recorder.state === "stopped" && recorder.records.length > 0 ? (
            <div className="mx-4 mt-4 rounded-xl border border-emerald-900 bg-emerald-950/30 p-3 text-sm text-emerald-200 sm:mx-5">
              Session saved in memory. Click <span className="font-semibold">Download .FIT</span> and import at <a className="underline" href="https://connect.garmin.com/modern/import-data" target="_blank" rel="noreferrer">Garmin Connect Import</a>. Validate at fitfileviewer.com if needed.
            </div>
          ) : null}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 sm:p-5">
            <div className="lg:col-span-2 rounded-xl bg-black/40 border border-zinc-800 p-4">
              <div className="text-xs uppercase tracking-widest text-zinc-500 mb-2">Live Chart · HR / Pace</div>
              {recorder.records.length === 0 ? (
                <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-zinc-700 text-sm text-zinc-500">Start session to record — chart will appear here</div>
              ) : (
                <LiveChart records={recorder.records} />
              )}
            </div>
            <div className="space-y-4">
              <LapTrack distanceM={sessionDistanceM} />
              <HrAlertSettings hr={hr} />
            </div>
          </div>
        </section>

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

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 font-mono text-xs">
          <div className="font-semibold text-zinc-300 mb-1">Debug · Raw BLE</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-zinc-400">
            <span>FootPod: <span className={footpod.status === "connected" ? "text-emerald-400" : "text-amber-400"}>{footpod.status}</span> {footpod.deviceName ? `(${footpod.deviceName})` : ""}</span>
            <span>HR: <span className={hrCardStatus === "connected" ? "text-emerald-400" : "text-amber-400"}>{hrCardStatus}</span> {hrCardName ? `(${hrCardName}${hrIsShared ? " via Foot Pod" : ""})` : ""}</span>
            <span>HR: {hr ?? "--"} bpm</span>
            <span>speedMs: {speedMs != null ? speedMs.toFixed(2) : "--"} ({smoothSpeed != null ? smoothSpeed.toFixed(2) : "--"} smooth)</span>
            <span>cad: {cadence ?? "--"} ({smoothCadence != null ? Math.round(smoothCadence) : "--"} smooth)</span>
            <span>stride: {strideM != null ? strideM.toFixed(2) : "--"} m</span>
            <span>dist: {distanceM != null ? distanceM.toFixed(1) : "--"} m {hasGarminDistanceRef.current ? "(Garmin)" : "(integrated)"} / session {sessionDistanceM.toFixed(1)} m</span>
            <span>records: {recorder.records.length}</span>
            <span>state: {recorder.state}</span>
          </div>
          {footpod.error ? <div className="mt-1 text-amber-400">Foot Pod: {footpod.error}</div> : null}
          {heartrate.error ? <div className="mt-1 text-amber-400">HR: {heartrate.error}</div> : null}
          {footpod.status === "connected" && (speedMs == null || cadence == null) ? <div className="mt-1 text-amber-400">RSC connected but no speed/cadence yet — start Virtual Run activity on watch and start moving (treadmill). If still 0, check watch is in Virtual Run, not Broadcast HR.</div> : null}
        </div>

        <details className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <summary className="cursor-pointer text-sm font-semibold">Help & Troubleshooting</summary>
          <ul className="mt-2 list-disc pl-5 text-sm text-zinc-400 space-y-1">
            <li>Use Chrome or Edge. Firefox/Safari do not support Web Bluetooth.</li>
            <li>Open via <code className="text-zinc-200">http://localhost:3000</code> • secure context required. <code>http://192.168.x.x</code> will fail.</li>
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
