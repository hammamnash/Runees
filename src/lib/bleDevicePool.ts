// ─────────────────────────────────────────────────────────────────────────────
// bleDevicePool.ts
// Device-pool store: separates DEVICE CONNECTION (native BLE picker) from
// SOURCE ASSIGNMENT (which connected device feeds Foot Pod / Heart Rate).
//
// Design:
//  - One GATT server per physical device (cached in `registry`).
//  - `assignments` maps each source slot → a granted device id.
//  - Auto-reconnect is serialized via a single module-level `reconnectingPromise`.
//  - Persistence: pool (`runees_devices`) + per-source (`runees_source_footpod`
//    / `runees_source_heartrate`). Stale ids become "unassigned", never error.
// ─────────────────────────────────────────────────────────────────────────────

import { parseHeartRate, parseRsc } from "@/lib/bleParser";

export type BleSlot = "footpod" | "heartrate";
export type BleDeviceStatus = "disconnected" | "connecting" | "connected" | "error";

export interface DeviceInfo {
  manufacturer?: string;
  model?: string;
  firmware?: string;
}

// Metrics shape emitted to the hook (re-exported by useBleSource for compat).
export interface BleSourceMetrics {
  hr: number | null;
  speedMs: number | null;
  cadence: number | null; // steps/min (already ×2 from strides)
  strideM: number | null;
  distanceM: number | null;
  isRunning: boolean | null;
}

// ── Web Bluetooth (minimal, untyped) ────────────────────────────────────────
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
export interface BleDevice {
  id?: string;
  name?: string;
  gatt: { connect: () => Promise<unknown>; connected: boolean; disconnect: () => void };
  addEventListener: (e: string, cb: () => void) => void;
  removeEventListener?: (e: string, cb: () => void) => void;
}

// ── Persistence keys ────────────────────────────────────────────────────────
const LS_DEVICES = "runees_devices";
const LS_SOURCE = (slot: BleSlot) => `runees_source_${slot}`;

// ── Internal registry: one entry per physical device ───────────────────────
type RegistryEntry = {
  device: BleDevice;
  server: GattServer;
  refCount: number;
  slots: Set<BleSlot>;
  hrAttached: boolean;
  rscAttached: boolean;
  batteryTimer: number | null;
};

const registryKey = (device: BleDevice): string | null => device.id ?? device.name ?? null;

export interface PooledDevice {
  id: string | null;
  name: string | null;
  status: BleDeviceStatus;
  batteryPct: number | null;
  deviceInfo: DeviceInfo | null;
  error: string | null;
  refCount: number;
  slots: BleSlot[];
}

type Listener = () => void;

export interface PoolState {
  devices: PooledDevice[];
  assignments: Record<BleSlot, string | null>;
  reconnectInProgress: boolean;
}

// ── Module-level state ──────────────────────────────────────────────────────
const registry = new Map<string, RegistryEntry>();
let devices: PooledDevice[] = [];
let assignments: Record<BleSlot, string | null> = { footpod: null, heartrate: null };
let reconnectInProgress = false;
let reconnectPromise: Promise<void> | null = null;
const listeners = new Set<Listener>();

// Cached snapshot: recomputed only when state mutates (stable reference for
// useSyncExternalStore, which compares snapshots with Object.is).
let currentSnapshot: PoolState = { devices: [], assignments: { ...assignments }, reconnectInProgress: false };

function recomputeSnapshot() {
  currentSnapshot = { devices: [...devices], assignments: { ...assignments }, reconnectInProgress };
}

function emit() {
  recomputeSnapshot();
  listeners.forEach((l) => l());
}

function getSnapshot(): PoolState {
  return currentSnapshot;
}

// Stable snapshot for server rendering / hydration. Must return a value that
// identity-compares equal across server renders and matches the first client
// snapshot. Connection state is client-only, so return an empty pool.
const SERVER_SNAPSHOT: PoolState = { devices: [], assignments: { footpod: null, heartrate: null }, reconnectInProgress: false };
function getServerSnapshot(): PoolState {
  return SERVER_SNAPSHOT;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ── Bluetooth helper ────────────────────────────────────────────────────────
function getBluetooth(): { bluetooth?: unknown } | null {
  if (typeof navigator === "undefined") return null;
  return navigator as unknown as { bluetooth?: unknown };
}

const ALL_SERVICES = [0x180d, 0x1814, 0x180f, 0x180a]; // HR, RSC, Battery, Device Info
const RSC_SERVICE = 0x1814;
const RSC_CHAR = 0x2a53;
const HR_SERVICE = 0x180d;
const HR_CHAR = 0x2a37;
const BATTERY_SERVICE = 0x180f;
const BATTERY_CHAR = 0x2a19;
const DEVICEINFO_SERVICE = 0x180a;

// ── Persistence ─────────────────────────────────────────────────────────────
function savePool() {
  if (typeof window === "undefined") return;
  try {
    const pool = devices
      .filter((d) => d.id)
      .map((d) => ({ id: d.id, name: d.name }));
    localStorage.setItem(LS_DEVICES, JSON.stringify(pool));
    localStorage.setItem(LS_SOURCE("footpod"), assignments.footpod ?? "");
    localStorage.setItem(LS_SOURCE("heartrate"), assignments.heartrate ?? "");
  } catch {}
}

function loadAssignments(): Record<BleSlot, string | null> {
  const a: Record<BleSlot, string | null> = { footpod: null, heartrate: null };
  if (typeof window === "undefined") return a;
  try {
    const f = localStorage.getItem(LS_SOURCE("footpod")) ?? "";
    const h = localStorage.getItem(LS_SOURCE("heartrate")) ?? "";
    a.footpod = f || null;
    a.heartrate = h || null;
  } catch {}
  return a;
}

// ── Device info / battery reads ─────────────────────────────────────────────
async function readBattery(server: GattServer): Promise<number | null> {
  try {
    const svc = await server.getPrimaryService(BATTERY_SERVICE);
    const ch = await svc.getCharacteristic(BATTERY_CHAR);
    const dv = await ch.readValue();
    return dv.getUint8(0);
  } catch {
    return null;
  }
}

async function readDeviceInfo(server: GattServer): Promise<DeviceInfo | null> {
  const info: DeviceInfo = {};
  try {
    const svc = await server.getPrimaryService(DEVICEINFO_SERVICE);
    const readStr = async (chUuid: number, key: keyof DeviceInfo) => {
      try {
        const ch = await svc.getCharacteristic(chUuid);
        const dv = await ch.readValue();
        const str = new TextDecoder()
          .decode(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength))
          .replace(/\0/g, "");
        if (str) info[key] = str;
      } catch {}
    };
    await readStr(0x2a29, "manufacturer");
    await readStr(0x2a24, "model");
    await readStr(0x2a26, "firmware");
  } catch {}
  return info.manufacturer || info.model || info.firmware ? info : null;
}

function patchDevice(id: string | null, patch: Partial<PooledDevice>) {
  const idx = devices.findIndex((d) => d.id === id);
  if (idx >= 0) {
    devices = devices.map((d, i) => (i === idx ? { ...d, ...patch } : d));
    emit();
  }
}

function removeDevice(id: string | null) {
  devices = devices.filter((d) => d.id !== id);
  registry.delete(String(id));
  // Clear any assignment pointing to the removed device.
  let changed = false;
  (["footpod", "heartrate"] as BleSlot[]).forEach((s) => {
    if (assignments[s] === id) {
      assignments = { ...assignments, [s]: null };
      changed = true;
    }
  });
  emit();
  if (changed) savePool();
}

// ── Notification attachment (guarded, one per device) ──────────────────────
function attachNotificationsFor(
  slot: BleSlot,
  server: GattServer,
  entry: RegistryEntry,
  onMetrics: (m: Partial<Record<string, unknown>>) => void
) {
  const wantHr = slot === "footpod" || slot === "heartrate";
  const wantRsc = slot === "footpod";

  if (wantHr && !entry.hrAttached) {
    (async () => {
      try {
        const s = await server.getPrimaryService(HR_SERVICE);
        const c = await s.getCharacteristic(HR_CHAR);
        await c.startNotifications();
        c.addEventListener("characteristicvaluechanged", (ev: Event) => {
          const dv = (ev.target as unknown as { value: DataView }).value;
          if (!dv) return;
          const { hr } = parseHeartRate(dv);
          onMetrics({ hr });
        });
        entry.hrAttached = true;
      } catch (e) {
        console.warn(`[bleDevicePool] HR service not available on ${entry.device.name}`, e);
      }
    })();
  }

  if (wantRsc && !entry.rscAttached) {
    (async () => {
      try {
        const s = await server.getPrimaryService(RSC_SERVICE);
        const c = await s.getCharacteristic(RSC_CHAR);
        await c.startNotifications();
        c.addEventListener("characteristicvaluechanged", (ev: Event) => {
          const dv = (ev.target as unknown as { value: DataView }).value;
          if (!dv) return;
          const r = parseRsc(dv);
          onMetrics({
            speedMs: r.speedMs,
            cadence: r.cadenceSpm * 2, // strides → steps for display
            strideM: r.strideM,
            distanceM: r.distanceM,
            isRunning: r.isRunning,
          });
        });
        entry.rscAttached = true;
      } catch (e) {
        console.warn(`[bleDevicePool] RSC service not available on ${entry.device.name}`, e);
        patchDevice(entry.device.id ?? null, {
          error: "Connected but no Running Speed/Cadence. Enable Virtual Run on your watch.",
        });
      }
    })();
  }
}

// ── Attach a source slot to a device (guarded, one per device) ─────────────
export function attachSlotSource(
  slot: BleSlot,
  deviceId: string | null,
  onMetrics: (m: Partial<Record<string, unknown>>) => void
) {
  if (!deviceId) return;
  const entry = registry.get(deviceId);
  if (!entry) return;
  entry.slots.add(slot);
  entry.refCount = entry.slots.size;
  attachNotificationsFor(slot, entry.server, entry, onMetrics);
  patchDevice(deviceId, { refCount: entry.refCount, slots: Array.from(entry.slots) });
}

// ── Connect a single device (no source attachment — split from assign) ─────
export async function connectDevice(device: BleDevice): Promise<boolean> {
  const key = registryKey(device);
  if (!key) return false;

  let entry = registry.get(key);
  if (entry) {
    // Already connected — bump status back to connected (was maybe error).
    patchDevice(key, { status: "connected", error: null });
    return true;
  }

  patchDevice(key, { status: "connecting", error: null });
  try {
    const server = (await device.gatt.connect()) as GattServer;
    entry = {
      device,
      server,
      refCount: 1,
      slots: new Set(),
      hrAttached: false,
      rscAttached: false,
      batteryTimer: null,
    };
    registry.set(key, entry);

    device.addEventListener("gattserverdisconnected", () => {
      if (registry.has(key)) {
        if (entry!.batteryTimer != null) window.clearInterval(entry!.batteryTimer);
        registry.delete(key);
        patchDevice(key, { status: "disconnected", refCount: 0, error: "Device disconnected. Click Connect to reconnect." });
      }
    });

    const battery = await readBattery(server);
    const info = await readDeviceInfo(server);
    patchDevice(key, { status: "connected", batteryPct: battery, deviceInfo: info, error: null });

    const timer = window.setInterval(async () => {
      const b = await readBattery(server);
      patchDevice(key, { batteryPct: b });
    }, 60000);
    entry.batteryTimer = timer;

    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    patchDevice(key, { status: "error", error: msg });
    return false;
  }
}

// ── Public: register a device into the pool (after picker / getDevices) ────
export function registerDevice(device: BleDevice) {
  const key = registryKey(device);
  if (!key) return;
  const existing = devices.find((d) => d.id === key);
  if (existing) return;
  devices = [...devices, { id: key, name: device.name ?? null, status: "disconnected", batteryPct: null, deviceInfo: null, error: null, refCount: 0, slots: [] }];
  savePool();
  emit();
}

// ── Public: native picker (fixed optionalServices superset) ────────────────
export async function pickDevice(): Promise<BleDevice | null> {
  const bt = getBluetooth()?.bluetooth as {
    requestDevice?: (opts: unknown) => Promise<unknown>;
  } | null;
  if (!bt?.requestDevice) return null;
  const device = (await bt.requestDevice({
    filters: [
      { services: [HR_SERVICE as unknown as string] },
      { services: [RSC_SERVICE as unknown as string] },
    ],
    // Fixed superset — must be requested upfront so any source can grab it later.
    optionalServices: ALL_SERVICES as unknown as string[],
  })) as BleDevice;
  registerDevice(device);
  await connectDevice(device);
  return device;
}

// ── Public: disconnect a single device (removes from pool) ─────────────────
export function disconnectDevice(id: string | null) {
  if (!id) return;
  const entry = registry.get(id);
  if (entry) {
    try {
      if (entry.device.gatt.connected) entry.device.gatt.disconnect();
    } catch {}
    if (entry.batteryTimer != null) window.clearInterval(entry.batteryTimer);
    registry.delete(id);
  }
  removeDevice(id);
}

// ── Public: forget (remove from pool + persistence, no disconnect) ─────────
export function forgetDevice(id: string | null) {
  removeDevice(id);
}

// ── Public: assign a granted device to a source slot ───────────────────────
export function assignSource(slot: BleSlot, deviceId: string | null) {
  assignments = { ...assignments, [slot]: deviceId };
  savePool();
  emit();
}

// ── Public: list granted devices via getDevices() ──────────────────────────
export async function refreshDevices(): Promise<void> {
  const bt = getBluetooth()?.bluetooth as { getDevices?: () => Promise<unknown[]> } | null;
  if (!bt?.getDevices) return;
  const granted = (await bt.getDevices()) as BleDevice[];
  granted.forEach((d) => registerDevice(d));
}

// ── Serialized auto-reconnect ──────────────────────────────────────────────
export function autoReconnect(): Promise<void> {
  if (reconnectPromise) return reconnectPromise;
  reconnectInProgress = true;
  emit();
  reconnectPromise = (async () => {
    const bt = getBluetooth()?.bluetooth as { getDevices?: () => Promise<unknown[]> } | null;
    if (bt?.getDevices) {
      const granted = (await bt.getDevices()) as BleDevice[];
      granted.forEach((d) => registerDevice(d));
      for (const d of granted) {
        if (!registry.has(String(d.id ?? d.name))) {
          await connectDevice(d);
        }
      }
    }
    // Re-apply assignments (stale ids become unassigned).
    const a = loadAssignments();
    (["footpod", "heartrate"] as BleSlot[]).forEach((s) => {
      if (a[s] && !devices.some((d) => d.id === a[s])) {
        a[s] = null; // stale → unassigned
      }
    });
    assignments = a;
    savePool();
    reconnectInProgress = false;
    emit();
  })().finally(() => {
    reconnectPromise = null;
  });
  return reconnectPromise;
}

// ── Read helpers for the hook ──────────────────────────────────────────────
export function getPoolSnapshot(): PoolState {
  return getSnapshot();
}

export function getDeviceForSlot(slot: BleSlot): PooledDevice | null {
  const id = assignments[slot];
  if (!id) return null;
  return devices.find((d) => d.id === id) ?? null;
}

// ── Store subscription for useSyncExternalStore ────────────────────────────
export const poolStore = { subscribe, getSnapshot, getServerSnapshot };
