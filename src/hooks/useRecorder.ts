"use client";
import { useCallback, useRef, useState } from "react";
import type { FitRecord, FitSession } from "@/lib/fitEncoder";

export type SessionState = "idle" | "recording" | "paused" | "stopped";

export function useRecorder() {
  const [state, setState] = useState<SessionState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [records, setRecords] = useState<FitRecord[]>([]);
  const startTimeRef = useRef<Date | null>(null);
  const pausedAccumRef = useRef(0);
  const pauseStartRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const stateRef = useRef<SessionState>("idle");
  const latestRef = useRef<{ hr: number | null; cadence: number | null; speedMs: number | null; distanceM: number | null }>({
    hr: null,
    cadence: null,
    speedMs: null,
    distanceM: null,
  });

  const tick = useCallback(() => {
    if (!startTimeRef.current) return;
    const now = Date.now();
    const paused = pausedAccumRef.current + (pauseStartRef.current ? now - pauseStartRef.current : 0);
    const elapsed = now - startTimeRef.current.getTime() - paused;
    setElapsedMs(elapsed);
  }, []);

  const start = useCallback(() => {
    const now = new Date();
    startTimeRef.current = now;
    pausedAccumRef.current = 0;
    pauseStartRef.current = null;
    setElapsedMs(0);
    setRecords([]);
    stateRef.current = "recording";
    setState("recording");
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(tick, 200);
  }, [tick]);

  const pause = useCallback(() => {
    if (stateRef.current !== "recording") return;
    pauseStartRef.current = Date.now();
    stateRef.current = "paused";
    setState("paused");
    if (timerRef.current) window.clearInterval(timerRef.current);
  }, []);

  const resume = useCallback(() => {
    if (stateRef.current !== "paused" || pauseStartRef.current == null) return;
    pausedAccumRef.current += Date.now() - pauseStartRef.current;
    pauseStartRef.current = null;
    stateRef.current = "recording";
    setState("recording");
    timerRef.current = window.setInterval(tick, 200);
  }, [tick]);

  const stop = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (pauseStartRef.current) {
      pausedAccumRef.current += Date.now() - pauseStartRef.current;
      pauseStartRef.current = null;
    }
    tick();
    stateRef.current = "stopped";
    setState("stopped");
  }, [tick]);

  const reset = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    startTimeRef.current = null;
    pausedAccumRef.current = 0;
    pauseStartRef.current = null;
    setElapsedMs(0);
    setRecords([]);
    stateRef.current = "idle";
    setState("idle");
  }, []);

  const pushSample = useCallback(
    (sample: { hr: number | null; cadence: number | null; speedMs: number | null; distanceM: number | null }) => {
      latestRef.current = sample;
      // Use ref to avoid stale closure — state in deps would recreate callback every render
      if (stateRef.current !== "recording") return;
      setRecords((prev) => [
        ...prev,
        {
          timestamp: new Date(),
          heartRate: sample.hr,
          cadence: sample.cadence,
          speedMs: sample.speedMs,
          distanceM: sample.distanceM,
        },
      ]);
    },
    []
  );

  const getSession = useCallback((): FitSession | null => {
    if (!startTimeRef.current) return null;
    const hrs = records.map((r) => r.heartRate).filter((v): v is number => v != null && v !== 0xff);
    // records store steps/min (display), FIT expects strides/min → halve for session
    const cadsSteps = records.map((r) => r.cadence).filter((v): v is number => v != null && v !== 0xff);
    const cads = cadsSteps.map((v) => Math.round(v / 2));
    const speeds = records.map((r) => r.speedMs).filter((v): v is number => v != null);
    const totalDistanceM = records.length ? (records[records.length - 1].distanceM ?? 0) : 0;
    return {
      startTime: startTimeRef.current,
      totalElapsedMs: elapsedMs,
      totalTimerMs: elapsedMs,
      totalDistanceM,
      avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
      maxHr: hrs.length ? Math.max(...hrs) : null,
      avgCadence: cads.length ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null,
      maxCadence: cads.length ? Math.max(...cads) : null,
      avgSpeedMs: speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null,
      maxSpeedMs: speeds.length ? Math.max(...speeds) : null,
    };
  }, [records, elapsedMs]);

  const getLaps = useCallback(() => {
    if (!startTimeRef.current || records.length === 0) return [];
    const laps: { index: number; startTime: Date; endTime: Date; distanceM: number; records: FitRecord[] }[] = [];
    let lapStartIdx = 0;
    let lapStartDist = records[0].distanceM ?? 0;
    for (let i = 1; i < records.length; i++) {
      const d = records[i].distanceM ?? 0;
      if (d - lapStartDist >= 1000) {
        const slice = records.slice(lapStartIdx, i + 1);
        laps.push({ index: laps.length, startTime: slice[0].timestamp, endTime: slice[slice.length - 1].timestamp, distanceM: d - lapStartDist, records: slice });
        lapStartIdx = i + 1;
        lapStartDist = d;
      }
    }
    if (lapStartIdx < records.length) {
      const slice = records.slice(lapStartIdx);
      const lastD = slice[slice.length - 1].distanceM ?? lapStartDist;
      laps.push({ index: laps.length, startTime: slice[0].timestamp, endTime: slice[slice.length - 1].timestamp, distanceM: lastD - lapStartDist, records: slice });
    }
    return laps;
  }, [records]);

  return { state, elapsedMs, records, start, pause, resume, stop, reset, pushSample, getSession, getLaps, startTime: startTimeRef.current };
}
