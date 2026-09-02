﻿"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MetricCard } from "@/components/MetricCard";
import { HrZoneGauge } from "@/components/HrZoneGauge";
import { ClockCard } from "@/components/ClockCard";
import { LiveChart } from "@/components/LiveChart";
import { LapTrack } from "@/components/LapTrack";
import { HrAlertSettings } from "@/components/HrAlertSettings";
import { MetronomeCard } from "@/components/MetronomeCard";
import { ParticleField } from "@/components/ParticleField";
import { useBleSource } from "@/hooks/useBleSource";
import { useRecorder } from "@/hooks/useRecorder";
import { paceMinPerKm, speedKmh } from "@/lib/bleParser";
import { getHrZone, HrZoneConfig } from "@/lib/hrZones";
import { hrZoneStore } from "@/lib/hrZoneStore";
import { metronomeStore } from "@/lib/metronomeStore";
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
  const [settingsOpen, setSettingsOpen] = useState(true);
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

  // Metronome engine state (running + bpm). Read here so the collapsed Settings
  // header can show cuing status even while the card itself is unmounted.
  const metro = useSyncExternalStore(
    metronomeStore.subscribe,
    metronomeStore.getSnapshot,
    metronomeStore.getServerSnapshot
  );

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

  const zoneSettings = useSyncExternalStore(
    hrZoneStore.subscribe,
    hrZoneStore.getSnapshot,
    hrZoneStore.getServerSnapshot
  );
  const zoneCfg: HrZoneConfig = {
    method: zoneSettings.method,
    maxHr: zoneSettings.maxHr,
    restingHr: zoneSettings.restingHr,
  };
  const zone = getHrZone(hr ?? 0, zoneSettings.maxHr, zoneCfg);
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
  const avgHrZone = avgHr != null ? getHrZone(avgHr, zoneSettings.maxHr, zoneCfg) : null;

  // Device clock (derived from the 500ms `now` ticker)
  const clockTime = now != 0 ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now) : "--:--:--";
  const clockDate = now != 0 ? new Intl.DateTimeFormat(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" }).format(now) : "";
  const clockTz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
    } catch {
      return "Local time";
    }
  })();

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
    <main className="relative min-h-screen bg-void text-white">
      <ParticleField />
      <div className="relative z-10">
      <header className="sticky top-0 z-20 bg-void/70 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-5 lg:px-12">
          <div className="flex items-center gap-3">
            {/* Triangular logo mark — Dala lockup */}
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
              <defs>
                <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#8052ff" />
                  <stop offset="100%" stopColor="#15846e" />
                </linearGradient>
              </defs>
              <path d="M12 2 L22 20 L2 20 Z" fill="url(#logoGrad)" />
            </svg>
            <span className="text-display text-2xl text-white">Runees</span>
            <span className="hidden sm:inline text-xs font-light text-ash">Indoor Run Monitor</span>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex cursor-pointer items-center gap-2 text-xs uppercase tracking-nav text-ash transition-colors hover:text-white">
              <input type="checkbox" checked={mock} onChange={(e) => setMock(e.target.checked)} className="accent-[#8052ff]" /> Mock
            </label>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] space-y-10 px-6 pb-24 pt-8 lg:px-12">
        {/* Hero headline block — oversized typographic composition */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="eyebrow mb-6">Live Telemetry</p>
            <h1 className="text-display text-5xl text-white md:text-7xl">
              Every stride,<br />measured.
            </h1>
          </div>
          <div className="flex flex-col justify-end">
            <p className="text-body-light max-w-md text-lg text-mist">
              On watch: <span className="text-white">Hold Menu &gt; Sensors &gt; Virtual Run</span> then start. Keep this tab in the foreground — pace and cadence require Virtual Run, not Broadcast HR.
            </p>
          </div>
        </section>

        {/* Settings — device connection + HR zone configuration (collapsible) */}
        <div className="glass-panel">
          <button
            onClick={() => setSettingsOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-3 text-left"
            aria-expanded={settingsOpen}
          >
            <span className="flex min-w-0 items-center gap-4">
              <span className="eyebrow">Settings</span>
              {!settingsOpen ? (
                <span className="flex min-w-0 flex-wrap items-center gap-4 text-xs text-ash">
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${footpod.status === "connected" ? "bg-emerald-500" : footpod.status === "connecting" ? "bg-amber-500 animate-pulse" : "bg-zinc-700"}`} />
                    Foot Pod: {pool.assignments.footpod ? (pool.devices.find((d) => d.id === pool.assignments.footpod)?.name || pool.assignments.footpod) : "—"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${hrCardStatus === "connected" ? "bg-emerald-500" : hrCardStatus === "connecting" ? "bg-amber-500 animate-pulse" : "bg-zinc-700"}`} />
                    HR: {pool.assignments.heartrate ? (pool.devices.find((d) => d.id === pool.assignments.heartrate)?.name || pool.assignments.heartrate) : "—"}
                  </span>
                  {metro.running ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-iris" />
                      Metronome: <span className="metric-num text-white">{metro.bpm}</span> spm
                    </span>
                  ) : null}
                </span>
              ) : null}
            </span>
            <svg
              className={`h-4 w-4 shrink-0 text-ash transition-transform ${settingsOpen ? "rotate-180" : ""}`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden
            >
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </button>
          {settingsOpen ? (
          <>
          <div className="grid grid-cols-1 gap-6 pt-8 lg:grid-cols-2 lg:gap-16">
        {/* Column 1 — Devices stacked above Metronome */}
        <div className="flex min-w-0 flex-col gap-6">
        {/* Devices + Source Assignment — connect device(s) once, then assign each source */}
        <section className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 pb-6">
            <button
              onClick={() => setDevicesOpen((v) => !v)}
              className="flex min-w-0 items-center gap-4 text-left"
              aria-expanded={devicesOpen}
            >
              <h2 className="text-display text-3xl text-white md:text-4xl">Devices</h2>
              {!devicesOpen ? (
                <span className="flex min-w-0 flex-wrap items-center gap-4 text-xs text-ash">
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${footpod.status === "connected" ? "bg-emerald-500" : footpod.status === "connecting" ? "bg-amber-500 animate-pulse" : "bg-zinc-700"}`} />
                    Foot Pod: {pool.assignments.footpod ? (pool.devices.find((d) => d.id === pool.assignments.footpod)?.name || pool.assignments.footpod) : "—"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${hrCardStatus === "connected" ? "bg-emerald-500" : hrCardStatus === "connecting" ? "bg-amber-500 animate-pulse" : "bg-zinc-700"}`} />
                    HR: {pool.assignments.heartrate ? (pool.devices.find((d) => d.id === pool.assignments.heartrate)?.name || pool.assignments.heartrate) : "—"}
                  </span>
                </span>
              ) : null}
            </button>
            <div className="flex shrink-0 items-center gap-4">
              {devicesOpen ? (
                <button
                  onClick={handleAddDevice}
                  className="iris-pill !py-2.5 !px-5"
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
                  className={`h-4 w-4 text-ash transition-transform ${devicesOpen ? "rotate-180" : ""}`}
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
          <div className="space-y-3 pb-8">
            {pool.devices.length === 0 ? (
              <div className="text-body-light text-sm text-ash">No devices connected. Click <span className="text-white">Connect Device</span> to open the browser BLE picker.</div>
            ) : (
              pool.devices.map((d) => {
                const isFoot = pool.assignments.footpod === d.id;
                const isHr = pool.assignments.heartrate === d.id;
                return (
                  <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`h-2 w-2 rounded-full ${d.status === "connected" ? "bg-emerald-500" : d.status === "connecting" ? "bg-amber-500 animate-pulse" : d.status === "error" ? "bg-red-500" : "bg-zinc-700"}`} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white">{d.name || d.id}</div>
                        <div className="text-xs text-ash">
                          {d.status === "connected" ? "Connected" : d.status === "connecting" ? "Connecting..." : d.status === "error" ? "Error" : "Disconnected"}
                          {d.batteryPct != null ? ` • ${d.batteryPct}%` : ""}
                          {d.deviceInfo?.model ? ` • ${d.deviceInfo.model}` : ""}
                        </div>
                        {d.error ? <div className="text-xs text-saffron">{d.error}</div> : null}
                        {isFoot || isHr ? (
                          <div className="mt-0.5 text-xs text-iris">
                            → {[isFoot ? "Foot Pod" : null, isHr ? "Heart Rate" : null].filter(Boolean).join(" + ")}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <button onClick={() => handleDisconnectDevice(d.id)} className="ghost-btn text-xs">
                      Disconnect
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Per-source assignment dropdowns */}
          <div className="grid grid-cols-1 gap-8 pb-8 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${footpod.status === "connected" ? "bg-emerald-500" : footpod.status === "connecting" ? "bg-amber-500 animate-pulse" : "bg-zinc-700"}`} />
                  <span className="label-caps text-white">Foot Pod</span>
                  <span className="text-xs font-light text-ash">RSC • pace/cadence/distance</span>
                </div>
              </div>
              <select
                className="w-full cursor-pointer rounded-card bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:bg-white/10"
                value={pool.assignments.footpod ?? ""}
                onChange={(e) => handleAssignSource("footpod", e.target.value || null)}
              >
                <option value="">— Unassigned —</option>
                {pool.devices.map((d) => (
                  <option key={d.id} value={d.id ?? ""} className="bg-black">{d.name || d.id}</option>
                ))}
              </select>
              {footpod.error ? <div className="text-xs text-saffron">{footpod.error}</div> : null}
              {footpod.supportMessage ? <div className="text-xs text-red-400">{footpod.supportMessage}</div> : null}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${hrCardStatus === "connected" ? "bg-emerald-500" : hrCardStatus === "connecting" ? "bg-amber-500 animate-pulse" : "bg-zinc-700"}`} />
                  <span className="label-caps text-white">Heart Rate</span>
                  <span className="text-xs font-light text-ash">HR</span>
                </div>
              </div>
              <select
                className="w-full cursor-pointer rounded-card bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:bg-white/10"
                value={pool.assignments.heartrate ?? ""}
                onChange={(e) => handleAssignSource("heartrate", e.target.value || null)}
              >
                <option value="">— Unassigned —</option>
                {pool.devices.map((d) => (
                  <option key={d.id} value={d.id ?? ""} className="bg-black">{d.name || d.id}</option>
                ))}
              </select>
              {hrIsShared ? <div className="text-xs font-light text-ash">Using watch HR. Assign a dedicated device for more accurate HR.</div> : null}
              {heartrate.error ? <div className="text-xs text-saffron">{heartrate.error}</div> : null}
              {heartrate.supportMessage ? <div className="text-xs text-red-400">{heartrate.supportMessage}</div> : null}
            </div>
          </div>
            </>
          ) : null}
        </section>

          {/* Metronome — stacked below Devices inside column 1 */}
          <MetronomeCard liveCadence={displayCad} />
        </div>

        {/* Column 2 — HR zone configuration lives in Settings */}
        <div>
          <HrAlertSettings hr={hr} />
        </div>
          </div>
          </>
          ) : null}
        </div>
        {/* Live Metrics — device time row + HR + pace + cadence */}
        <div className="glass-panel">
          <p className="eyebrow mb-2">Live Metrics</p>
          {/* Compact device time strip */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pb-4">
            <span className="metric-num text-2xl text-white">{clockTime}</span>
            <span className="text-body-light text-xs text-ash">{clockDate} · {clockTz}</span>
          </div>
          <div className="grid grid-cols-1 gap-32 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label={`Heart Rate ${zone ? `• ${zone.label}` : ""}`}
            value={hr != null ? String(hr) : "--"}
            unit="bpm"
            sub={hr != null ? <HrZoneGauge hr={hr} cfg={zoneCfg} /> : "Connect to see HR"}
            colorClass={zone?.color || "text-white"}
          />
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="eyebrow !text-ash">Pace</span>
              <button onClick={() => setShowKmh((v) => !v)} className="ghost-btn text-xs">
                {showKmh ? "Show min/km" : "Show km/h"}
              </button>
            </div>
            <div className="metric-num text-6xl text-white lg:text-6xl">
              {showKmh ? (
                <>
                  {kmh} <span className="text-2xl font-light text-ash">km/h</span>
                </>
              ) : (
                <>
                  {pace} <span className="text-2xl font-light text-ash">/km</span>
                </>
              )}
            </div>
            <div className="text-body-light text-sm text-ash">{showKmh ? `Pace ${pace} /km` : `${kmh} km/h`}</div>
          </div>
          <MetricCard label="Cadence" value={cadDisplay} unit="spm" sub={`${strideM != null ? `Stride ${strideM.toFixed(2)} m` : "Steps per minute"}${isHoldingCad ? " · Holding" : isStationary ? " · Stationary" : ""}`} />
          </div>
        </div>

        {/* Session Box — unified: header + metrics + chart/track. Distance/chart/track only count after Start */}
        <section className="glass-panel overflow-hidden">
          {/* Session header: Start at top */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4">
            <div className="flex flex-wrap items-center gap-4">
              <h2 className="text-display text-3xl text-white md:text-4xl">Session</h2>
              <span className={`h-2 w-2 rounded-full ${recorder.state === "recording" ? "bg-emerald-500 animate-pulse" : recorder.state === "paused" ? "bg-amber-500" : recorder.state === "stopped" ? "bg-zinc-500" : "bg-zinc-700"}`} />
              <span className="metric-num text-lg text-mist">{formatTime(recorder.elapsedMs)}</span>
              <span className="hidden text-xs capitalize text-ash sm:inline">· {recorder.state}</span>
              <span className="text-xs font-light text-ash">{recorder.records.length} samples</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {recorder.state === "idle" && (
                <button onClick={handleStart} className="iris-pill">Start</button>
              )}
              {recorder.state === "recording" && (
                <>
                  <button onClick={recorder.pause} className="iris-pill">Pause</button>
                  <button onClick={recorder.stop} className="ghost-pill">Stop</button>
                </>
              )}
              {recorder.state === "paused" && (
                <>
                  <button onClick={recorder.resume} className="iris-pill">Resume</button>
                  <button onClick={recorder.stop} className="ghost-pill">Stop</button>
                </>
              )}
              {recorder.state === "stopped" && (
                <>
                  <button onClick={handleDownload} className="iris-pill">Download .FIT</button>
                  <button onClick={handleReset} className="ghost-pill">Reset</button>
                </>
              )}
            </div>
          </div>

          {recorder.state === "idle" ? (
            <div className="text-body-light pb-8 text-sm text-ash">Press <span className="text-white">Start</span> to begin recording. Distance, chart and track will stay at zero until then.</div>
          ) : null}

          {/* Session metrics — sessionDistanceM / avgPace / avgHr only meaningful after Start */}
          <div className="grid grid-cols-2 gap-8 pb-6 md:grid-cols-4">
            <div>
              <div className="eyebrow !text-ash mb-3">Time</div>
              <div className="metric-num text-4xl text-white">{formatTime(recorder.elapsedMs)}</div>
              <div className="mt-2 text-xs capitalize font-light text-ash">{recorder.state} · 1 Hz</div>
            </div>
            <div>
              <div className="eyebrow !text-ash mb-3">Distance</div>
              <div className="metric-num text-4xl text-white">{distKm} <span className="text-lg font-light text-ash">km</span></div>
              <div className="mt-2 text-xs font-light text-ash">Session total</div>
            </div>
            <div>
              <div className="eyebrow !text-ash mb-3">Avg Pace</div>
              <div className="metric-num text-4xl text-white">{avgPace} <span className="text-lg font-light text-ash">/km</span></div>
              <div className="mt-2 text-xs font-light text-ash">{recorder.records.length ? `${(sessionDistanceM / 1000).toFixed(2)} km` : "—"}</div>
            </div>
            <div>
              <div className="eyebrow !text-ash mb-3">Avg HR {avgHrZone ? `• ${avgHrZone.label}` : ""}</div>
              <div className={`metric-num text-4xl ${avgHrZone?.color || "text-white"}`}>{avgHr != null ? avgHr : "--"} <span className="text-lg font-light text-ash">bpm</span></div>
              <div className="mt-2 text-xs font-light text-ash">{avgHrZone ? avgHrZone.label : recorder.records.length ? "No HR samples yet" : "—"}</div>
            </div>
          </div>

          {recorder.state === "stopped" && recorder.records.length > 0 ? (
            <div className="text-body-light mb-6 text-sm text-verdant">
              Session saved in memory. Click <span className="text-white">Download .FIT</span> and import at <a className="text-saffron underline" href="https://connect.garmin.com/modern/import-data" target="_blank" rel="noreferrer">Garmin Connect Import</a>. Validate at fitfileviewer.com if needed.
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="eyebrow !text-ash mb-4">Live Chart · HR / Pace</div>
              {recorder.records.length === 0 ? (
                <div className="flex h-[260px] items-center justify-center text-sm font-light text-ash">Start session to record — chart will appear here</div>
              ) : (
                <LiveChart records={recorder.records} />
              )}
            </div>
            <div className="space-y-2">
              <LapTrack distanceM={sessionDistanceM} />

              {/* Auto-laps table — below track animation */}
              {recorder.getLaps().length > 0 ? (
                <div>
                  <div className="eyebrow !text-ash mb-2">Auto-laps · 1 km</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase tracking-nav text-ash">
                        <tr><th className="py-2 text-left">Lap</th><th className="text-right">Dist</th><th className="text-right">Time</th><th className="text-right">Pace</th><th className="text-right">Avg HR</th></tr>
                      </thead>
                      <tbody>
                        {recorder.getLaps().map((lap) => {
                          const secs = (lap.endTime.getTime() - lap.startTime.getTime()) / 1000;
                          const pace = secs > 0 && lap.distanceM > 0 ? paceMinPerKm(lap.distanceM / secs) : "--:--";
                          const avgHr = lap.records.filter((r) => r.heartRate).length ? Math.round(lap.records.filter((r) => r.heartRate).reduce((a, b) => a + (b.heartRate ?? 0), 0) / Math.max(1, lap.records.filter((r) => r.heartRate).length)) : "--";
                          return (
                            <tr key={lap.index} className="border-t border-white/10">
                              <td className="py-2.5 text-white">{lap.index + 1}</td>
                              <td className="py-2.5 text-right text-mist">{(lap.distanceM / 1000).toFixed(2)} km</td>
                              <td className="py-2.5 text-right text-mist">{formatTime(lap.endTime.getTime() - lap.startTime.getTime())}</td>
                              <td className="py-2.5 text-right text-mist">{pace} /km</td>
                              <td className="py-2.5 text-right text-mist">{avgHr}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <div className="glass-panel font-mono text-xs text-ash">
          <div className="eyebrow !text-ash mb-2">Debug · Raw BLE</div>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span>FootPod: <span className={footpod.status === "connected" ? "text-emerald-400" : "text-saffron"}>{footpod.status}</span> {footpod.deviceName ? `(${footpod.deviceName})` : ""}</span>
            <span>HR: <span className={hrCardStatus === "connected" ? "text-emerald-400" : "text-saffron"}>{hrCardStatus}</span> {hrCardName ? `(${hrCardName}${hrIsShared ? " via Foot Pod" : ""})` : ""}</span>
            <span>HR: {hr ?? "--"} bpm</span>
            <span>speedMs: {speedMs != null ? speedMs.toFixed(2) : "--"} ({smoothSpeed != null ? smoothSpeed.toFixed(2) : "--"} smooth)</span>
            <span>cad: {cadence ?? "--"} ({smoothCadence != null ? Math.round(smoothCadence) : "--"} smooth)</span>
            <span>stride: {strideM != null ? strideM.toFixed(2) : "--"} m</span>
            <span>dist: {distanceM != null ? distanceM.toFixed(1) : "--"} m {hasGarminDistanceRef.current ? "(Garmin)" : "(integrated)"} / session {sessionDistanceM.toFixed(1)} m</span>
            <span>records: {recorder.records.length}</span>
            <span>state: {recorder.state}</span>
          </div>
          {footpod.error ? <div className="mt-1 text-saffron">Foot Pod: {footpod.error}</div> : null}
          {heartrate.error ? <div className="mt-1 text-saffron">HR: {heartrate.error}</div> : null}
          {footpod.status === "connected" && (speedMs == null || cadence == null) ? <div className="mt-1 text-saffron">RSC connected but no speed/cadence yet — start Virtual Run activity on watch and start moving (treadmill). If still 0, check watch is in Virtual Run, not Broadcast HR.</div> : null}
        </div>

        <details className="glass-panel group">
          <summary className="ghost-btn cursor-pointer text-sm">Help & Troubleshooting</summary>
          <ul className="text-body-light mt-4 list-disc space-y-2 pl-5 text-sm text-mist">
            <li>Use Chrome or Edge. Firefox/Safari do not support Web Bluetooth.</li>
            <li>Open via <code className="text-white">http://localhost:3000</code> • secure context required. <code>http://192.168.x.x</code> will fail.</li>
            <li>On Forerunner: Virtual Run broadcasts HR + pace/cadence. Broadcast HR alone gives only HR.</li>
            <li>If no RSC: check watch is in Virtual Run, not just Broadcast HR.</li>
            <li>Keep tab foreground; background tabs may throttle BLE.</li>
            <li>Mock toggle simulates data for UI testing without watch.</li>
          </ul>
        </details>
      </div>
      </div>
    </main>
  );
}
