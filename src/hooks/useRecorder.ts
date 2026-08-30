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
    setState("recording");
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(tick, 200);
  }, [tick]);

  const pause = useCallback(() => {
    if (state !== "recording") return;
    pauseStartRef.current = Date.now();
    setState("paused");
    if (timerRef.current) window.clearInterval(timerRef.current);
  }, [state]);

  const resume = useCallback(() => {
    if (state !== "paused" || pauseStartRef.current == null) return;
    pausedAccumRef.current += Date.now() - pauseStartRef.current;
    pauseStartRef.current = null;
    setState("recording");
    timerRef.current = window.setInterval(tick, 200);
  }, [state, tick]);

  const stop = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (pauseStartRef.current) {
      pausedAccumRef.current += Date.now() - pauseStartRef.current;
      pauseStartRef.current = null;
    }
    tick();
    setState("stopped");
  }, [tick]);

  const reset = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    startTimeRef.current = null;
    pausedAccumRef.current = 0;
    pauseStartRef.current = null;
    setElapsedMs(0);
    setRecords([]);
    setState("idle");
  }, []);

  const pushSample = useCallback(
    (sample: { hr: number | null; cadence: number | null; speedMs: number | null; distanceM: number | null }) => {
      latestRef.current = sample;
      if (state === "recording") {
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
      }
    },
    [state]
  );

  const getSession = useCallback((): FitSession | null => {
    if (!startTimeRef.current) return null;
    const hrs = records.map((r) => r.heartRate).filter((v): v is number => v != null && v !== 0xff);
    const cads = records.map((r) => r.cadence).filter((v): v is number => v != null && v !== 0xff);
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

  return { state, elapsedMs, records, start, pause, resume, stop, reset, pushSample, getSession, startTime: startTimeRef.current };
}
