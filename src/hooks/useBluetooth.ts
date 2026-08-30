"use client";
import { useCallback, useRef, useState } from "react";
import { parseHeartRate, parseRsc } from "@/lib/bleParser";

export type BleStatus = "disconnected" | "connecting" | "connected";

export interface LiveMetrics {
  hr: number | null;
  speedMs: number | null;
  cadence: number | null;
  strideM: number | null;
  distanceM: number | null;
  isRunning: boolean | null;
}

export function useBluetooth(onMetrics: (m: Partial<LiveMetrics>) => void) {
  const [status, setStatus] = useState<BleStatus>("disconnected");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deviceRef = useRef<unknown>(null);
  const isSupported = typeof navigator !== "undefined" && "bluetooth" in navigator;

  const disconnect = useCallback(async () => {
    try {
      const d = deviceRef.current as { gatt?: { connected: boolean; disconnect: () => void } } | null;
      if (d?.gatt?.connected) d.gatt.disconnect();
    } catch {}
    setStatus("disconnected");
    setDeviceName(null);
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    if (!isSupported) {
      setError("Web Bluetooth not supported. Use Chrome or Edge on Windows.");
      return;
    }
    try {
      setStatus("connecting");
      const nav = navigator as unknown as { bluetooth: { requestDevice: (opts: unknown) => Promise<unknown> } };
      const device = (await nav.bluetooth.requestDevice({
        filters: [{ services: [0x180d] }, { services: [0x1814] }],
        optionalServices: [0x180d, 0x1814, 0x180f, 0x180a],
      })) as { name?: string; gatt: { connect: () => Promise<unknown> }; addEventListener: (e: string, cb: () => void) => void };
      deviceRef.current = device;
      setDeviceName(device.name || "Garmin");
      device.addEventListener("gattserverdisconnected", () => {
        setStatus("disconnected");
        setError("Device disconnected. Click Connect to reconnect.");
      });
      const server = (await device.gatt.connect()) as {
        getPrimaryService: (u: number) => Promise<{ getCharacteristic: (u: number) => Promise<{ startNotifications: () => Promise<void>; addEventListener: (e: string, cb: (ev: Event) => void) => void }> }>;
      };
      try {
        const hrService = await server.getPrimaryService(0x180d);
        const hrChar = await hrService.getCharacteristic(0x2a37);
        await hrChar.startNotifications();
        hrChar.addEventListener("characteristicvaluechanged", (ev: Event) => {
          const dv = (ev.target as unknown as { value: DataView }).value;
          if (!dv) return;
          const { hr } = parseHeartRate(dv);
          onMetrics({ hr });
        });
      } catch (e) {
        console.warn("HR service not available", e);
      }
      try {
        const rscService = await server.getPrimaryService(0x1814);
        const rscChar = await rscService.getCharacteristic(0x2a53);
        await rscChar.startNotifications();
        rscChar.addEventListener("characteristicvaluechanged", (ev: Event) => {
          const dv = (ev.target as unknown as { value: DataView }).value;
          if (!dv) return;
          const r = parseRsc(dv);
          onMetrics({
            speedMs: r.speedMs,
            cadence: r.cadenceSpm,
            strideM: r.strideM,
            distanceM: r.distanceM,
            isRunning: r.isRunning,
          });
        });
      } catch (e) {
        console.warn("RSC service not available - enable Virtual Run on watch", e);
        setError("Connected but no Running Speed/Cadence. Enable Virtual Run on your Forerunner.");
      }
      setStatus("connected");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("User cancelled") || msg.includes("NotFoundError")) setError("No device selected.");
      else setError(msg);
      setStatus("disconnected");
    }
  }, [isSupported, onMetrics]);

  return { status, deviceName, error, isSupported, connect, disconnect };
}
