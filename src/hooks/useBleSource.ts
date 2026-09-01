"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  assignSource,
  attachSlotSource,
  autoReconnect,
  disconnectDevice,
  forgetDevice,
  getDeviceForSlot,
  pickDevice,
  poolStore,
  type BleSlot,
} from "@/lib/bleDevicePool";
import type { BleSourceMetrics, DeviceInfo } from "@/lib/bleDevicePool";

export type BleStatus = "disconnected" | "connecting" | "connected";

export type { BleSourceMetrics, DeviceInfo, BleSlot };

export function useBleSource(
  slot: BleSlot,
  onMetrics: (m: Partial<BleSourceMetrics>) => void
) {
  useSyncExternalStore(poolStore.subscribe, poolStore.getSnapshot, poolStore.getServerSnapshot);

  const device = getDeviceForSlot(slot);
  const status: BleStatus = device
    ? device.status === "connected"
      ? "connected"
      : device.status === "connecting"
      ? "connecting"
      : "disconnected"
    : "disconnected";

  const deviceName = device?.name ?? null;
  const deviceId = device?.id ?? null;
  const error = device?.error ?? null;
  const batteryPct = device?.batteryPct ?? null;
  const deviceInfo = device?.deviceInfo ?? null;

  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const onMetricsRef = useRef(onMetrics);
  useEffect(() => { onMetricsRef.current = onMetrics; }, [onMetrics]);

  useEffect(() => {
    setIsSupported(typeof navigator !== "undefined" && "bluetooth" in navigator);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      autoReconnect().catch(() => {});
    }, 800);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (device?.status === "connected") {
      attachSlotSource(slot, device.id, (m) => onMetricsRef.current(m as Partial<BleSourceMetrics>));
    }
  }, [slot, device?.id, device?.status]);

  const connect = useCallback(async () => {
    if (isSupported === false) return;
    const device = await pickDevice();
    if (device?.id) assignSource(slot, device.id);
  }, [isSupported, slot]);

  const disconnect = useCallback(async () => {
    if (deviceId) disconnectDevice(deviceId);
  }, [deviceId]);

  const forget = useCallback(() => {
    if (deviceId) forgetDevice(deviceId);
    if (deviceId) assignSource(slot, null);
  }, [deviceId, slot]);

  const connectById = useCallback(
    async (id: string) => {
      assignSource(slot, id);
      return true;
    },
    [slot]
  );

  return {
    status,
    deviceName,
    deviceId,
    error,
    batteryPct,
    deviceInfo,
    isSupported,
    connect,
    disconnect,
    forget,
    connectById,
  };
}
