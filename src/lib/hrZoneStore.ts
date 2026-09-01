// ─────────────────────────────────────────────────────────────────────────────
// hrZoneStore.ts
// Reactive store for HR zone settings (method, max HR, resting HR) plus the
// HR alert settings. Emits changes via subscribe/getSnapshot so the page and
// the settings card stay in sync reactively (no reload needed).
//
// Persistence keys (backwards compatible with HrAlertSettings):
//   runees_hrMethod     => "max" | "hrr"
//   runees_maxHr        => number (kept from v1)
//   runees_restingHr    => number
//   runees_hrAlert      => number (threshold, kept from v1)
//   runees_hrAlertEnabled => "1" | "0" (kept from v1)
// ─────────────────────────────────────────────────────────────────────────────

import { HrZoneMethod } from "@/lib/hrZones";

export interface HrZoneSettings {
  method: HrZoneMethod;
  maxHr: number;
  restingHr: number;
  alertThreshold: number;
  alertEnabled: boolean;
}

const DEFAULT_SETTINGS: HrZoneSettings = {
  method: "max",
  maxHr: 190,
  restingHr: 76,
  alertThreshold: 175,
  alertEnabled: false,
};

const KEYS = {
  method: "runees_hrMethod",
  maxHr: "runees_maxHr",
  restingHr: "runees_restingHr",
  alertThreshold: "runees_hrAlert",
  alertEnabled: "runees_hrAlertEnabled",
};

function readNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(key);
  if (v == null) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(key);
  if (v == null) return fallback;
  return v === "1";
}

function readMethod(): HrZoneMethod {
  if (typeof window === "undefined") return DEFAULT_SETTINGS.method;
  const v = window.localStorage.getItem(KEYS.method);
  return v === "hrr" ? "hrr" : "max";
}

function load(): HrZoneSettings {
  return {
    method: readMethod(),
    maxHr: readNumber(KEYS.maxHr, DEFAULT_SETTINGS.maxHr),
    restingHr: readNumber(KEYS.restingHr, DEFAULT_SETTINGS.restingHr),
    alertThreshold: readNumber(KEYS.alertThreshold, DEFAULT_SETTINGS.alertThreshold),
    alertEnabled: readBool(KEYS.alertEnabled, DEFAULT_SETTINGS.alertEnabled),
  };
}

function persist(s: HrZoneSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEYS.method, s.method);
  window.localStorage.setItem(KEYS.maxHr, String(s.maxHr));
  window.localStorage.setItem(KEYS.restingHr, String(s.restingHr));
  window.localStorage.setItem(KEYS.alertThreshold, String(s.alertThreshold));
  window.localStorage.setItem(KEYS.alertEnabled, s.alertEnabled ? "1" : "0");
}

let state: HrZoneSettings = load();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function setState(patch: Partial<HrZoneSettings>) {
  state = { ...state, ...patch };
  persist(state);
  emit();
}

export const hrZoneStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): HrZoneSettings {
    return state;
  },
  getServerSnapshot(): HrZoneSettings {
    return DEFAULT_SETTINGS;
  },
  setMethod(method: HrZoneMethod) {
    setState({ method });
  },
  setMaxHr(maxHr: number) {
    const n = Number.isFinite(maxHr) && maxHr > 0 ? Math.round(maxHr) : DEFAULT_SETTINGS.maxHr;
    setState({ maxHr: n });
  },
  setRestingHr(restingHr: number) {
    const n = Number.isFinite(restingHr) && restingHr > 0 ? Math.round(restingHr) : DEFAULT_SETTINGS.restingHr;
    setState({ restingHr: n });
  },
  setAlertThreshold(threshold: number) {
    const n = Number.isFinite(threshold) && threshold > 0 ? Math.round(threshold) : DEFAULT_SETTINGS.alertThreshold;
    setState({ alertThreshold: n });
  },
  setAlertEnabled(enabled: boolean) {
    setState({ alertEnabled: enabled });
  },
};
