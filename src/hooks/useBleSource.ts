"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseHeartRate, parseRsc } from "@/lib/bleParser";

export type BleStatus = "disconnected" | "connecting" | "connected";
export type BleSlot = "footpod" | "heartrate";

export interface BleSourceMetrics {
  hr: number | null;
  speedMs: number | null;
  cadence: number | null; // steps/min (already ×2 from strides)
  strideM: number | null;
  distanceM: number | null;
  isRunning: boolean | null;
}

export interface DeviceInfo {
  manufacturer?: string;
  model?: string;
  firmware?: string;
}

interface GattCharacteristic {
  readValue: () => Promise<DataView>;
  startNotifications: () => Promise<GattCharacteristic>;
  addEventListener: (e: string, cb: (ev: Event) => void) => void;
}
interface GattService {
  getCharacteristic: (u: number) => Promise<GattCharacteristic>;
}
interface GattServer {
  getPrimaryService: (u: number) => Promise<GattService>;
}

const LS_KEY = (slot: BleSlot) => `runees_ble_${slot}_id`;
const LS_NAME = (slot: BleSlot) => `runees_ble_${slot}_name`;

function getBluetooth(): unknown {
  if (typeof navigator === "undefined") return null;
  return (navigator as unknown as { bluetooth?: unknown }).bluetooth ?? null;
}

export function useBleSource(
  slot: BleSlot,
  onMetrics: (m: Partial<BleSourceMetrics>) => void
) {
  const [status, setStatus] = useState<BleStatus>("disconnected");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batteryPct, setBatteryPct] = useState<number | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const deviceRef = useRef<unknown>(null);
  const serverRef = useRef<GattServer | null>(null);
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const autoReconnectTried = useRef(false);

  useEffect(() => {
    setIsSupported(typeof navigator !== "undefined" && "bluetooth" in navigator);
    try {
      const n = localStorage.getItem(LS_NAME(slot));
      if (n) setDeviceName(n);
      const id = localStorage.getItem(LS_KEY(slot));
      if (id) setDeviceId(id);
    } catch {}
  }, [slot]);

  const readBattery = useCallback(async (server: GattServer) => {
    try {
      const svc = await server.getPrimaryService(0x180f);
      const ch = await svc.getCharacteristic(0x2a19);
      const dv = await ch.readValue();
      setBatteryPct(dv.getUint8(0));
    } catch {}
  }, []);

  const readDeviceInfo = useCallback(async (server: GattServer) => {
    const info: DeviceInfo = {};
    try {
      const svc = await server.getPrimaryService(0x180a);
      try {
        const ch = await svc.getCharacteristic(0x2a29);
        const dv = await ch.readValue();
        info.manufacturer = new TextDecoder().decode(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength)).replace(/\0/g, "");
      } catch {}
      try {
        const ch = await svc.getCharacteristic(0x2a24);
        const dv = await ch.readValue();
        info.model = new TextDecoder().decode(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength)).replace(/\0/g, "");
      } catch {}
      try {
        const ch = await svc.getCharacteristic(0x2a26);
        const dv = await ch.readValue();
        info.firmware = new TextDecoder().decode(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength)).replace(/\0/g, "");
      } catch {}
      if (info.manufacturer || info.model || info.firmware) setDeviceInfo(info);
    } catch {}
  }, []);

  const attachNotifications = useCallback(
    async (server: GattServer) => {
      // HR: for heartrate slot always, for footpod slot opportunistically (watch exposes both)
      if (slot === "heartrate" || slot === "footpod") {
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
          if (slot === "heartrate") console.warn(`[${slot}] HR service not available`, e);
        }
      }
      if (slot === "footpod") {
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
              cadence: r.cadenceSpm * 2,
              strideM: r.strideM,
              distanceM: r.distanceM,
              isRunning: r.isRunning,
            });
          });
        } catch (e) {
          console.warn(`[${slot}] RSC service not available`, e);
          setError("Connected but no Running Speed/Cadence. Enable Virtual Run on your Forerunner.");
        }
      }
    },
    [slot, onMetrics]
  );

  const connectWithDevice = useCallback(
    async (device: unknown) => {
      const d = device as {
        id?: string;
        name?: string;
        gatt: { connect: () => Promise<unknown>; connected: boolean; disconnect: () => void };
        addEventListener: (e: string, cb: () => void) => void;
      };
      deviceRef.current = device;
      const id = d.id ?? null;
      const name = d.name || (slot === "footpod" ? "Foot Pod" : "HR Strap");
      setDeviceId(id);
      setDeviceName(name);
      try {
        if (id) localStorage.setItem(LS_KEY(slot), id);
        localStorage.setItem(LS_NAME(slot), name);
      } catch {}
      d.addEventListener("gattserverdisconnected", () => {
        setStatus("disconnected");
        setError("Device disconnected. Click Choose to reconnect.");
      });
      const server = (await d.gatt.connect()) as GattServer;
      serverRef.current = server;
      await attachNotifications(server);
      readBattery(server);
      readDeviceInfo(server);
      setStatus("connected");
      setError(null);
    },
    [slot, attachNotifications, readBattery, readDeviceInfo]
  );

  const connect = useCallback(async () => {
    setError(null);
    if (isSupported === false) {
      setError("Web Bluetooth not supported. Use Chrome or Edge on Windows.");
      return;
    }
    try {
      setStatus("connecting");
      const bt = getBluetooth() as { requestDevice: (opts: unknown) => Promise<unknown> } | null;
      if (!bt) throw new Error("Bluetooth not available");
      const filters =
        slot === "footpod"
          ? [{ services: [0x1814] as unknown as string }]
          : [{ services: [0x180d] as unknown as string }];
      const optionalServices = slot === "footpod" ? [0x180d, 0x180f, 0x180a] : [0x1814, 0x180f, 0x180a];
      const device = await bt.requestDevice({
        filters,
        optionalServices,
      });
      await connectWithDevice(device);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("User cancelled") || msg.includes("NotFoundError") || msg.includes("cancelled")) setError("No device selected.");
      else setError(msg);
      setStatus("disconnected");
    }
  }, [slot, isSupported, connectWithDevice]);

  const connectById = useCallback(
    async (id: string) => {
      try {
        const bt = getBluetooth() as { getDevices?: () => Promise<unknown[]> } | null;
        if (!bt?.getDevices) return false;
        const devices = (await bt.getDevices()) as { id: string }[];
        const found = devices.find((d) => d.id === id);
        if (!found) return false;
        setStatus("connecting");
        await connectWithDevice(found);
        return true;
      } catch {
        return false;
      }
    },
    [connectWithDevice]
  );

  const disconnect = useCallback(async () => {
    try {
      const d = deviceRef.current as { gatt?: { connected: boolean; disconnect: () => void } } | null;
      if (d?.gatt?.connected) d.gatt.disconnect();
    } catch {}
    setStatus("disconnected");
    setBatteryPct(null);
    setDeviceInfo(null);
  }, []);

  const forget = useCallback(() => {
    try {
      localStorage.removeItem(LS_KEY(slot));
      localStorage.removeItem(LS_NAME(slot));
    } catch {}
    setDeviceId(null);
    setDeviceName(null);
    setError(null);
    // also disconnect if connected
    disconnect();
  }, [slot, disconnect]);

  // auto-reconnect on mount if we have a stored id and getDevices is available
  useEffect(() => {
    if (autoReconnectTried.current) return;
    autoReconnectTried.current = true;
    try {
      const stored = localStorage.getItem(LS_KEY(slot));
      if (!stored) return;
      // delay slightly to let isSupported resolve
      const t = window.setTimeout(() => {
        connectById(stored).catch(() => {});
      }, 800);
      return () => window.clearTimeout(t);
    } catch {}
  }, [slot, connectById]);

  // poll battery while connected
  useEffect(() => {
    if (status !== "connected" || !serverRef.current) return;
    const id = window.setInterval(() => {
      if (serverRef.current) readBattery(serverRef.current);
    }, 60000);
    return () => window.clearInterval(id);
  }, [status, readBattery]);

  return { status, deviceName, deviceId, error, batteryPct, deviceInfo, isSupported, connect, disconnect, forget, connectById };
}
