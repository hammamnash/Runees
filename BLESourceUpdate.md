# BLE Source Update — Dev Plan & Progress Tracker

> Working doc for the **device-pool refactor**: split *device connection* (native BLE picker) from *source assignment* (which connected device feeds Foot Pod / HR). One device can serve both sources.

## Goal

Separate the concerns so the user:

1. **Connects device(s)** once via the browser's native BLE picker → forms a **pool of connected devices**.
2. **Assigns each data source** (Foot Pod → RSC, Heart Rate → HR) to *any already-connected device* from the pool.

On reload, the app **auto-reconnects saved devices** (`getDevices()`) and **re-applies per-source assignments**.

## Current Architecture (before)

- `src/hooks/useBleSource.ts` — per-`slot` hook (footpod / heartrate), each with its **own picker + GATT connect**. Module-level `registry` already caches one GATT server per device (`hrAttached`/`rscAttached` flags, refCount).
- Persistence is **per-slot**: `runees_ble_{slot}_id` + `runees_ble_{slot}_name`.
- `src/app/page.tsx` — "Sources" panel with per-slot Choose/Disconnect/Forget buttons; owns HR priority/fallback (strap wins, 5s watch fallback).

## Target Architecture (after)

Module-level **device pool store** + slim `useBleSource(slot)` that subscribes to its assigned device.

```
Device Pool store            (src/lib/bleDevicePool.ts)
  ├─ devices: PooledDevice[]     { id, name, status, batteryPct, deviceInfo, error, refCount, slots:Set }
  ├─ assignments: { footpod, heartrate }   → each = deviceId | null
  ├─ actions: connectDevice, disconnectDevice(id), forgetDevice(id),
  │           assignSource(slot, id|null), refreshDevices
  └─ guard:   reconnectingPromise   (serialized auto-reconnect)

useBleSource(slot, onMetrics)   (src/hooks/useBleSource.ts)
  ├─ reads store → resolves assigned deviceId → device
  ├─ attaches notifications (RSC for footpod, HR for heartrate/footpod)
  └─ returns { status, deviceName, deviceId, error, batteryPct, deviceInfo, ... }
```

## Key Implementation Requirements (user concerns)

1. `optionalServices` must be a **FIXED superset** `[0x180D, 0x1814, 0x180F, 0x180A]` at picker time (can't add services after connect).
2. The assignment dropdown can **only list granted devices** (from `getDevices()` / the pool). No assigning-from-nothing.
3. **One GATT server per device**, subscriptions guarded (`hrAttached`/`rscAttached`, refCount) so a shared subscription isn't started twice.
4. **Auto-reconnect serialized**: module-level `reconnectingPromise`, connect each granted device **once**, sequentially (not per-source with timers).
5. **Persistence schema changes**:
   - Pool: `runees_devices` → array of `{ id, name }`.
   - Per-source: `runees_source_footpod` / `runees_source_heartrate` → deviceId.
   - On load: read pool → reconnect each device once → apply assignments → subscribe.
   - Stale `deviceId` (permission revoked / browser cleared) → mark source **unassigned**, don't error.
6. **Keep HR priority/fallback logic** in `page.tsx` (strap wins, watch is 5s fallback) — unchanged.

---

## Phase 1 — Logic / Backend (BLE plumbing)

> Split into single-file sub-phases to avoid large one-shot edits. Each sub-phase must leave the project compiling.

### ✅ Sub-phase 1.1 — Create `src/lib/bleDevicePool.ts` (device-pool store)
- [x] Module-level store with `useSyncExternalStore`-compatible subscribe/getSnapshot.
- [x] `PooledDevice` type: `{ id, name, status, batteryPct, deviceInfo, error, refCount, slots }`.
- [x] `assignments: { footpod: string|null, heartrate: string|null }`.
- [x] Register granted devices (from `getDevices()` after picker/auto-reconnect).
- [x] Connect + cache one GATT server per device; guarded subscriptions; refCount.
- [x] `connectDevice()` → native picker with FIXED superset optionalServices.
- [x] `disconnectDevice(id)`, `forgetDevice(id)`, `assignSource(slot, id|null)`.
- [x] Serialized auto-reconnect via module-level `reconnectingPromise`.
- [x] Persistence: `runees_devices`, `runees_source_footpod`, `runees_source_heartrate`; stale-id → unassigned.
- [x] Connection split from source attachment (`connectDevice` vs `attachSlotSource`).
- [x] **Status:** DONE + VERIFIED (no errors)

> Note: `connectDevice(device)` no longer takes `onMetrics` — connection is orthogonal to source
> assignment. The hook owns `onMetrics` and calls `attachSlotSource(slot, deviceId, onMetrics)`.

### ✅ Sub-phase 1.2 — Rewrite `src/hooks/useBleSource.ts` to consume pool
- [x] Slim hook: subscribe to pool store, resolve owned device, attach notifications.
- [x] Keep return surface compatible (`status`, `deviceName`, `deviceId`, `error`, `batteryPct`, `deviceInfo`, `connect`, `disconnect`, `forget`, `connectById`, `isSupported`) so `page.tsx` still compiles in this phase.
- [x] `useSyncExternalStore` with `getServerSnapshot` + cached snapshot (SSR/hydration-safe).
- [x] **Status:** DONE + VERIFIED (tsc clean, build clean, lint clean)

### ✅ Sub-phase 1.3 — Verify build + lint
- [x] `npx tsc --noEmit` — clean (no errors).
- [x] `npm run build` — clean (121 kB / 209 kB). Only pre-existing `recorder` exhaustive-deps warning.
- [x] `npm run lint` — clean (same pre-existing warning).
- [x] **Status:** VERIFIED

---

## Phase 2 — Frontend / UI

### ✅ Sub-phase 2.1 — `src/app/page.tsx` Sources → Devices panel
- [x] Replace per-slot "Choose Foot Pod"/"Choose HR Strap" with a single `Connect Device` button (native picker).
- [x] "Connected Devices" section listing pool devices + per-source (Foot Pod / HR) dropdowns.
- [x] Per-source assignment dropdowns only list granted (pool) devices.
- [x] Show status/battery/info per device; per-source assignment status.
- [x] Keep HR priority/fallback wiring unchanged.
- [x] **Status:** DONE + VERIFIED (tsc clean, build clean 122 kB / 209 kB)

### ✅ Sub-phase 2.2 — Docs
- [x] Update `AGENT_INSTRUCTIONS.md` §4.3 connection flow.
- [x] Update `dev_progress.md` (Phase 4 device-pool entry).
- [x] **Status:** DONE

---

## ✅ Phase 2 COMPLETE — All sub-phases verified (tsc clean, build 122 kB / 209 kB, lint clean).

---

## Open Questions / Notes
- Dev server currently shows **404 at `http://localhost:3000`**; dev_progress says fallback is `3001`. Verify via build/lint rather than browser for now.
- Old per-slot keys `runees_ble_{slot}_*` — decide to read-and-migrate or ignore (recommend ignore; stale data cleared on first new upload).
- Keep `useBluetooth.ts` as legacy reference in Phase 1; may remove in Phase 2.

## Verification Checklist (runs after each sub-phase)
- [ ] `npm run build`
- [ ] `npm run lint`
