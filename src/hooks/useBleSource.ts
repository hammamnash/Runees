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
interface BleDevice {
  id?: string;
  name?: string;
  gatt: { connect: () => Promise<unknown>; connected: boolean; disconnect: () => void };
  addEventListener: (e: string, cb: () => void) => void;
  removeEventListener?: (e: string, cb: () => void) => void;
}

const LS_KEY = (slot: BleSlot) => `runees_ble_${slot}_id`;
const LS_NAME = (slot: BleSlot) => `runees_ble_${slot}_name`;

function getBluetooth(): unknown {
  if (typeof navigator === "undefined") return null;
  return (navigator as unknown as { bluetooth?: unknown }).bluetooth ?? null;
}

// ── Shared connection registry: one physical device → one GATT link ──
// When both slots pick the same watch, reuse the same server instead of
// opening a second gatt.connect() which destabilizes Windows/Chrome BLE.
type RegistryEntry = {
  device: BleDevice;
  server: GattServer;
  refCount: number;
  slots: Set<BleSlot>;
  hrAttached: boolean;
  rscAttached: boolean;
  batteryTimer: number | null;
  disconnectHandlers: Map<BleSlot, () => void>;
};
const registry = new Map<string, RegistryEntry>();

function getRegistryKey(device: BleDevice): string | null {
  return device.id ?? device.name ?? null;
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
  const deviceRef = useRef<BleDevice | null>(null);
  const serverRef = useRef<GattServer | null>(null);
  const registryKeyRef = useRef<string | null>(null);
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const autoReconnectTried = useRef(false);
  const onMetricsRef = useRef(onMetrics);
  useEffect(() => { onMetricsRef.current = onMetrics; }, [onMetrics]);

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
    async (server: GattServer, entry: RegistryEntry | null) => {
      const needHr = slot === "heartrate" || slot === "footpod";
      const needRsc = slot === "footpod";
      const hrAlready = !!entry?.hrAttached;
      const rscAlready = !!entry?.rscAttached;

      if (needHr) {
        try {
          const hrService = await server.getPrimaryService(0x180d);
          const hrChar = await hrService.getCharacteristic(0x2a37);
          if (!hrAlready) await hrChar.startNotifications();
          hrChar.addEventListener("characteristicvaluechanged", (ev: Event) => {
            const dv = (ev.target as unknown as { value: DataView }).value;
            if (!dv) return;
            const { hr } = parseHeartRate(dv);
            onMetricsRef.current({ hr });
          });
          if (entry) entry.hrAttached = true;
        } catch (e) {
          if (slot === "heartrate") console.warn(`[${slot}] HR service not available`, e);
        }
      }
      if (needRsc) {
        try {
          const rscService = await server.getPrimaryService(0x1814);
          const rscChar = await rscService.getCharacteristic(0x2a53);
          if (!rscAlready) await rscChar.startNotifications();
          rscChar.addEventListener("characteristicvaluechanged", (ev: Event) => {
            const dv = (ev.target as unknown as { value: DataView }).value;
            if (!dv) return;
            const r = parseRsc(dv);
            onMetricsRef.current({
              speedMs: r.speedMs,
              cadence: r.cadenceSpm * 2,
              strideM: r.strideM,
              distanceM: r.distanceM,
              isRunning: r.isRunning,
            });
          });
          if (entry) entry.rscAttached = true;
        } catch (e) {
          console.warn(`[${slot}] RSC service not available`, e);
          setError("Connected but no Running Speed/Cadence. Enable Virtual Run on your watch.");
        }
      }
    },
    [slot]
  );

  const handleDisconnect = useCallback(() => {
    const key = registryKeyRef.current;
    if (key) {
      const entry = registry.get(key);
      if (entry) {
        entry.slots.delete(slot);
        entry.disconnectHandlers.delete(slot);
        entry.refCount = entry.slots.size;
        if (entry.refCount === 0) {
          if (entry.batteryTimer != null) window.clearInterval(entry.batteryTimer);
          registry.delete(key);
        }
      }
      registryKeyRef.current = null;
    }
    deviceRef.current = null;
    serverRef.current = null;
    setStatus("disconnected");
    setBatteryPct(null);
    setDeviceInfo(null);
    setError("Device disconnected. Click Choose to reconnect.");
  }, [slot]);

  const connectWithDevice = useCallback(
    async (device: BleDevice) => {
      const id = device.id ?? null;
      const name = device.name || (slot === "footpod" ? "Foot Pod" : "HR Strap");
      const key = getRegistryKey(device);

      // ── Shared path: same physical device already connected via other slot ──
      if (key && registry.has(key)) {
        const entry = registry.get(key)!;
        // Reuse existing GATT server; just attach missing characteristics for this slot
        deviceRef.current = device;
        serverRef.current = entry.server;
        registryKeyRef.current = key;
        entry.slots.add(slot);
        entry.refCount = entry.slots.size;
        setDeviceId(id);
        setDeviceName(name);
        try {
          if (id) localStorage.setItem(LS_KEY(slot), id);
          localStorage.setItem(LS_NAME(slot), name);
        } catch {}
        // Attach only what this slot needs and hasn't been attached yet
        await attachNotifications(entry.server, entry);
        // Register disconnect handler for this slot (shared device disconnects all slots)
        const onDisc = () => {
          // Notify all slots sharing this device
          entry.disconnectHandlers.forEach((h) => h());
          if (entry.batteryTimer != null) window.clearInterval(entry.batteryTimer);
          registry.delete(key);
        };
        // Only add the physical listener once
        if (entry.disconnectHandlers.size === 0) {
          device.addEventListener("gattserverdisconnected", onDisc);
        }
        entry.disconnectHandlers.set(slot, handleDisconnect);
        setStatus("connected");
        setError(null);
        return;
      }

      // ── New physical connection ──
      deviceRef.current = device;
      const dispName = name;
      setDeviceId(id);
      setDeviceName(dispName);
      try {
        if (id) localStorage.setItem(LS_KEY(slot), id);
        localStorage.setItem(LS_NAME(slot), dispName);
      } catch {}

      const onDisc = handleDisconnect;
      device.addEventListener("gattserverdisconnected", onDisc);

      const server = (await device.gatt.connect()) as GattServer;
      serverRef.current = server;

      if (key) {
        const entry: RegistryEntry = {
          device,
          server,
          refCount: 1,
          slots: new Set([slot]),
          hrAttached: false,
          rscAttached: false,
          batteryTimer: null,
          disconnectHandlers: new Map([[slot, handleDisconnect]]),
        };
        registry.set(key, entry);
        registryKeyRef.current = key;
        await attachNotifications(server, entry);
        // Single battery poll per physical device
        const timer = window.setInterval(() => readBattery(server), 60000);
        entry.batteryTimer = timer;
      } else {
        // No stable key (no id/name) — fall back to direct attach without registry
        registryKeyRef.current = null;
        await attachNotifications(server, null);
      }

      readBattery(server);
      readDeviceInfo(server);
      setStatus("connected");
      setError(null);
    },
    [slot, attachNotifications, readBattery, readDeviceInfo, handleDisconnect]
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
      const device = (await (bt as { requestDevice: (opts: unknown) => Promise<unknown> }).requestDevice({
        filters,
        optionalServices,
      })) as BleDevice;
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
        const devices = (await bt.getDevices()) as BleDevice[];
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
    const key = registryKeyRef.current;
    if (key && registry.has(key)) {
      const entry = registry.get(key)!;
      entry.slots.delete(slot);
      entry.disconnectHandlers.delete(slot);
      entry.refCount = entry.slots.size;
      if (entry.refCount === 0) {
        // Last slot using this device — actually disconnect GATT
        try {
          if (deviceRef.current?.gatt?.connected) deviceRef.current.gatt.disconnect();
        } catch {}
        if (entry.batteryTimer != null) window.clearInterval(entry.batteryTimer);
        registry.delete(key);
      } else {
        // Other slot still using device — just detach this slot, keep GATT alive
        // Clear HR/RSC flags if no remaining slot needs them
        const remaining = Array.from(entry.slots);
        if (!remaining.includes("footpod")) entry.rscAttached = false;
        if (!remaining.includes("heartrate") && !remaining.includes("footpod")) entry.hrAttached = false;
      }
      registryKeyRef.current = null;
    } else {
      try {
        if (deviceRef.current?.gatt?.connected) deviceRef.current.gatt.disconnect();
      } catch {}
    }
    deviceRef.current = null;
    serverRef.current = null;
    setStatus("disconnected");
    setBatteryPct(null);
    setDeviceInfo(null);
  }, [slot]);

  const forget = useCallback(() => {
    try {
      localStorage.removeItem(LS_KEY(slot));
      localStorage.removeItem(LS_NAME(slot));
    } catch {}
    setDeviceId(null);
    setDeviceName(null);
    setError(null);
    disconnect();
  }, [slot, disconnect]);

  // auto-reconnect on mount — staggered to avoid race when both slots share same device
  useEffect(() => {
    if (autoReconnectTried.current) return;
    autoReconnectTried.current = true;
    try {
      const stored = localStorage.getItem(LS_KEY(slot));
      if (!stored) return;
      const delay = slot === "footpod" ? 800 : 1600;
      const t = window.setTimeout(() => {
        // If same device already connected via other slot's auto-reconnect, reuse it
        const bt = getBluetooth() as { getDevices?: () => Promise<unknown[]> } | null;
        if (!bt?.getDevices) return;
        bt.getDevices().then((devices) => {
          const found = (devices as BleDevice[]).find((d) => d.id === stored);
          if (!found) return;
          const key = getRegistryKey(found);
          if (key && registry.has(key)) {
            // Already connected via other slot — attach this slot to existing entry
            connectWithDevice(found).catch(() => {});
          } else {
            connectById(stored).catch(() => {});
          }
        }).catch(() => {});
      }, delay);
      return () => window.clearTimeout(t);
    } catch {}
  }, [slot, connectById, connectWithDevice]);

  // battery poll only for non-registry devices (registry devices poll via entry timer)
  useEffect(() => {
    if (status !== "connected" || !serverRef.current) return;
    if (registryKeyRef.current && registry.has(registryKeyRef.current)) return;
    const id = window.setInterval(() => {
      if (serverRef.current) readBattery(serverRef.current);
    }, 60000);
    return () => window.clearInterval(id);
  }, [status, readBattery]);

  return { status, deviceName, deviceId, error, batteryPct, deviceInfo, isSupported, connect, disconnect, forget, connectById };
}
