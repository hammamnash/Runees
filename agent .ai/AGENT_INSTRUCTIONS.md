# Runees • AI Agent Build Instructions

> **Source of truth for any AI agent implementing this repo.** Follow this file strictly. Do not deviate from stack/decisions without user approval.

## 1. Project Overview

**Runees** is a treadmill companion app for Windows laptops that connects via **Bluetooth Low Energy (BLE)** to **two independent sources — Foot Pod (RSC: pace/cadence/distance) and Heart Rate (HR strap)** — and displays live **Heart Rate (HR), Pace, Cadence, Stride, Distance** during a treadmill run. It can **record the session and export a Garmin-compatible `.FIT` file** for import into Garmin Connect.

**Primary use case:** User runs on treadmill, watch broadcasts via Virtual Run (foot pod) + optional chest strap for HR, laptop shows large readable metrics. One device can serve both inputs.

**Distribution:** Hybrid • **Web App (PWA) first**, then wrapped as **portable `.exe` via Tauri** (same web codebase). Must run on `localhost` without internet.

---

## 2. Locked Decisions (Do Not Re-ask)

| Decision | Value |
|---|---|
| Garmin mode | **Virtual Run** (Settings > Sensors > Virtual Run) • broadcasts HR + RSC |
| OS | **Windows 10/11 only** |
| Pace unit | **min/km** primary, km/h secondary toggle |
| Distance source | **Garmin RSC total distance** (`0x1814`) • no manual correction in MVP |
| HR zones | **Garmin defaults** (220-age based, 5 zones) • configurable later |
| FIT target | **Garmin Connect** only (Strava later) |
| Offline | Nice-to-have, PWA must work on `localhost` without internet after first load |
| Always-on-top | Not needed in MVP |
| Hybrid | **Web App core + Tauri portable wrapper** • single codebase |
| BLE sources | **Dual-source: Foot Pod (RSC) + Heart Rate (HR)** • independent pickers, one device can serve both |

### 2.1 Can Web App run on localhost only?

**Yes.** Web Bluetooth requires a [Secure Context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). `http://localhost` and `http://127.0.0.1` **are considered secure** • no HTTPS needed. `http://192.168.x.x` is **not** secure and will fail. For LAN access, use `https` or `localhost` tunnel. Tauri wrapper has no such restriction (native BLE).

---

## 3. Tech Stack (Mandatory)

**Web App (MVP):**
- Framework: **Next.js 14+ (App Router) + TypeScript** (or Vite + React + TS if simpler • prefer Next.js for PWA)
- Styling: **Tailwind CSS**
- BLE: **Web Bluetooth API** (`navigator.bluetooth`) • Chrome/Edge only, document this
- FIT encoding: **`fit-file-writer`** or manual FIT encoder (preferred: `fit-file-writer` npm)
- PWA: **`next-pwa`** or `vite-plugin-pwa` • offline cache, installable
- State: React hooks / Zustand (lightweight)
- Charts: `recharts` or `chart.js` for HR/pace history (phase 2)

**Tauri Wrapper (Phase 2, same web build):**
- **Tauri v2** • `src-tauri/` wraps `out/` or `build/`
- BLE plugin: `tauri-plugin-ble` or custom Rust `btleplug` backend • fallback to Web Bluetooth inside WebView if plugin unavailable
- Portable exe: `tauri build` with `portable: true` / single exe, no installer

**Tooling:**
- Node 22, npm
- ESLint + Prettier
- No Python backend • fully client-side

---

## 4. BLE GATT Specification

### 4.1 Services & Characteristics

| Service | UUID | Characteristic | UUID | Properties |
|---|---|---|---|---|
| Heart Rate | `0x180D` | Heart Rate Measurement | `0x2A37` | Notify |
| Running Speed & Cadence | `0x1814` | RSC Measurement | `0x2A53` | Notify |
| Running Speed & Cadence | `0x1814` | RSC Feature | `0x2A54` | Read |
| Battery | `0x180F` | Battery Level | `0x2A19` | Read/Notify (optional) |
| Device Info | `0x180A` | Manufacturer/Model | various | Read (optional) |

### 4.2 Parsing

**HR Measurement (`0x2A37`):**
```
flags: uint8
  bit0: 0 = HR uint8, 1 = HR uint16
  bit3: 0 = no energy, 1 = energy present
  bit4: 0 = no RR, 1 = RR-interval present
hr = flags & 0x01 ? data[1] + (data[2]<<8) : data[1]
```

**RSC Measurement (`0x2A53`):**
```
flags: uint8
  bit0: 0 = no stride, 1 = stride present
  bit1: 0 = no distance, 1 = distance present
  bit2: 0 = walking, 1 = running
speed: uint16 LE, unit 1/256 m/s  -> m/s = value / 256
cadence: uint8, unit 1/min (spm) -> spm = value
stride: uint16 LE, unit 1/100 m (if present) -> m = value / 100
distance: uint32 LE, unit 1/10 m (if present) -> m = value / 10
```

**Derived:**
- Pace $min/km$: $pace = \frac{1000}{speed \times 60}$ if $speed > 0$ else `•`
- Speed $km/h$: $speed \times 3.6$
- Stride $m$: from RSC or `•`

### 4.3 Connection Flow (Device Pool + Source Assignment)

Connection is **separated from source assignment**. The user connects device(s) once via the browser's native BLE picker (forming a **pool**), then assigns each source (Foot Pod / Heart Rate) to any connected device. One device (e.g. Garmin watch) can serve both sources at once.

```mermaid
flowchart TD
    A[User clicks Connect Device] --> B[navigator.bluetooth.requestDevice<br/>filters: 0x180D / 0x1814<br/>optionalServices: FIXED superset 0x180D,0x1814,0x180F,0x180A]
    B --> C[registerDevice -> pool]
    C --> D[connectDevice -> gatt.connect, cache one GATT server per device]
    D --> E[User assigns source: assignSource(slot, deviceId)]
    E --> F[attachSlotSource -> getPrimaryService + getCharacteristic + startNotifications]
    F --> G[oncharacteristicvaluechanged -> parse -> onMetrics]
    G --> H[HR priority: strap wins, watch fallback after 5s]
    H --> I[Update UI + Recorder if active]
```

- **`optionalServices` is a FIXED superset** `[0x180D, 0x1814, 0x180F, 0x180A]` requested at picker time — you can't add services after connecting. This is required so any source can be assigned later.
- **One GATT server per device.** `connectDevice` connects once and caches the server keyed by `deviceId`. Assigning Foot Pod + HR to the same watch reuses the same server; guarded `hrAttached`/`rscAttached` flags prevent starting a shared subscription twice.
- **Auto-reconnect is serialized.** On mount, reconnect each granted device **once**, sequentially, via a module-level `reconnectingPromise` (no per-source timers that can race).
- **Persistence schema:** device pool `runees_devices` = `[{ id, name }]`; per-source assignments `runees_source_footpod` / `runees_source_heartrate` = deviceId. On load: read pool → reconnect each device once → apply assignments by id → subscribe. A saved `deviceId` no longer in `getDevices()` (permission revoked / browser cleared) → source marked **unassigned**, no error.
- **HR priority:** HR strap (`heartrate` slot) is primary; foot pod HR is fallback if strap hasn't sent HR in 5s. RSC (pace/cadence/distance) always from foot pod slot. This logic lives in `page.tsx` (unchanged).

**Files:** `src/lib/bleDevicePool.ts` (device-pool store + `useSyncExternalStore`), `src/hooks/useBleSource.ts` (slim per-source hook).

---

## 5. Features

### 5.1 MVP (Must Ship First)

1.  **Scan & Connect (Dual-Source):** Two independent pickers — **Foot Pod** (RSC: pace/cadence/distance) and **Heart Rate** (HR strap). Each has Choose/Disconnect/Forget, status dot, battery + device info. One device can serve both. Auto-reconnect via `getDevices()` + localStorage. HR priority: strap → watch fallback (5s).
2.  **Live Dashboard (large, treadmill-readable):**
    *   HR: large $bpm$ + zone color (Z1 grey, Z2 blue, Z3 green, Z4 orange, Z5 red) + zone label
    *   Pace: $min/km$ large (e.g., `5:42 /km`) + $km/h$ small
    *   Cadence: $spm$ + stride $m$ small
    *   Timer: `HH:MM:SS` (from session start, pauses on pause)
    *   Distance: $km$ (2 decimals)
    *   Avg pace, avg HR
3.  **Session Control:** Start / Pause / Resume / Stop (Stop -> save prompt). Timer only counts when running (not paused). Distance from RSC cumulative.
4.  **Recording:** When session started, sample `Record` every 1s: timestamp, HR, speed, cadence, distance, stride. Store in memory + `localStorage` backup.
5.  **FIT Export:** On Stop, generate `.FIT` file valid for Garmin Connect import. Download via `a[download]`. Filename: `Runees_YYYY-MM-DD_HH-mm-ss.fit`.
6.  **PWA Offline:** Works on `http://localhost:3000` without internet after install. `manifest.json` + service worker caching static assets.
7.  **Error Handling:** No BLE support -> banner "Use Chrome/Edge on Windows". No device found -> help text "Enable Virtual Run on watch".

### 5.2 Phase 2 (Done)

- HR zone config + audio alert if HR > threshold ✓
- Live chart (HR/pace/cadence over time) ✓
- Live lap animation (400m stadium) ✓
- Auto-lap per km ✓
- Tauri portable exe wrapper (scaffolded) ✓

### 5.3 Phase 3 — Dual-Source BLE (Done 2026-08-31)

- **Foot Pod + HR strap** independent pickers (`useBleSource` per slot)
- One device can serve both inputs (watch exposes HR + RSC)
- HR priority: strap wins, watch fallback after 5s
- Auto-reconnect via `navigator.bluetooth.getDevices()` + localStorage (`runees_ble_{slot}_id`)
- Per-slot battery + device info, Forget button
- Sources panel UI (2 cards), per-source debug

---

## 6. FIT File Requirements

Generate a valid FIT Activity file that Garmin Connect accepts. Minimal messages:

| Message | Fields |
|---|---|
| `FileId` | type=4 (activity), manufacturer=1 (Garmin), product=0, serialNumber, timeCreated |
| `Activity` | timestamp, totalTimerTime, numSessions=1, type=0 (manual), event=26, eventType=1 |
| `Session` | messageIndex, timestamp, startTime, totalElapsedTime, totalTimerTime, totalDistance, avgHeartRate, maxHeartRate, avgCadence, maxCadence, avgSpeed, maxSpeed, sport=1 (running), subSport=0, trigger=0 |
| `Lap` | messageIndex, timestamp, startTime, totalElapsedTime, totalTimerTime, totalDistance, avgHeartRate, maxHeartRate, avgCadence, maxCadence, avgSpeed, maxSpeed |
| `Record` (per second) | timestamp, heartRate, cadence, speed (m/s *1000), distance (m *100), enhancedSpeed, enhancedAvgSpeed |

- Timestamps: FIT epoch = `1989-12-31T00:00:00Z`, or use library helper.
- Speed in FIT: `m/s * 1000` (uint16, scale 1000).
- Distance in FIT: `m` (uint32, scale 100).
- Validate with https://www.fitfileviewer.com/ before marking done.

---

## 7. UI/UX Requirements

- **Layout:** Single page, no auth. Header: title + Connect button + status dot. Main: 3 large cards (HR, Pace, Cadence) + Timer/Distance row + Controls + FIT download.
- **Readability:** Dark theme, large fonts (HR/Pace > 48px), high contrast • readable at arm length on treadmill.
- **Responsive:** Desktop first (laptop), but works on tablet.
- **States:** Disconnected (prompt to connect), Connected idle (show live values, Start enabled), Recording (timer running, Pause/Stop), Paused, Stopped (show summary + Download FIT).
- **Accessibility:** Keyboard operable, ARIA for live values (`aria-live="polite"`).

---

## 8. Project Structure (Enforce)

```
/
+-- app/ or src/           # Next.js app router
•   +-- page.tsx           # Dashboard
•   +-- layout.tsx
•   +-- globals.css
•   +-- components/
•   •   +-- ConnectButton.tsx
•   •   +-- MetricCard.tsx
•   •   +-- SessionControls.tsx
•   •   +-- FitDownloader.tsx
•   +-- hooks/
•   •   +-- useBleSource.ts      # Dual-source BLE (footpod/heartrate slots, auto-reconnect, HR priority)
•   •   +-- useBluetooth.ts      # Legacy single-source (kept for reference)
•   •   +-- useRecorder.ts       # session timer + records
•   +-- lib/
•       +-- bleParser.ts         # parse 0x2A37, 0x2A53
•       +-- fitEncoder.ts        # FIT generation
•       +-- hrZones.ts           # Garmin zones calc
+-- public/
•   +-- manifest.json
•   +-- icons/
+-- src-tauri/             # Phase 2
+-- package.json
+-- AGENT_INSTRUCTIONS.md  # this file
```

---

## 9. Implementation Phases (For Agent)

**Phase 1 • Web App MVP (Do First):**
1. Scaffold Next.js + TS + Tailwind + PWA.
2. Implement `bleParser.ts` with unit tests for HR/RSC parsing.
3. Implement `useBluetooth.ts` (requestDevice, notifications, disconnect handling).
4. Build Dashboard UI with mock data toggle (so dev without watch).
5. Implement `useRecorder.ts` + `fitEncoder.ts` + download.
6. Test with real Forerunner Virtual Run; validate FIT in Garmin Connect.

**Phase 2 • Polish + Tauri Portable (Done):**
1. HR alert + live chart + lap animation + auto-lap ✓
2. `npm create tauri-app` wrapper, configure `tauri.conf.json` for portable single exe ✓
3. `npm run tauri build` -> `src-tauri/target/release/Runees.exe` portable (requires Rust)

**Phase 3 • Dual-Source BLE (Done 2026-08-31):**
1. `useBleSource.ts` — per-slot hook with auto-reconnect + HR priority ✓
2. Dashboard Sources panel — Foot Pod + HR strap pickers ✓
3. Build + lint verification ✓

---

## 10. Acceptance Criteria

- [ ] `npm run dev` on `http://localhost:3000` shows dashboard, no console errors.
- [x] Sources panel: Foot Pod + HR strap pickers trigger browser picker, connect, show live HR/cadence/pace within 2s. One device can serve both.
- [x] Disconnect/reconnect + auto-reconnect (getDevices + localStorage) handled gracefully. HR fallback strap→watch (5s).
- [ ] Start/Pause/Stop timer works, distance increments from RSC.
- [ ] Stop generates `.fit` that imports into Garmin Connect without error (shows activity with HR/pace/cadence graphs).
- [ ] Works offline on localhost after first load (PWA cached).
- [ ] `npm run build` succeeds, `npm run lint` clean.
- [ ] Portable exe (phase 2) runs by double-click on Windows, no installer.

---

## 11. Non-Goals

- No backend, no database, no auth.
- No mobile app.
- No ANT+ support (BLE only).
- No cloud sync.

---

## 12. References

- Web Bluetooth Spec: https://webbluetoothcg.github.io/web-bluetooth/
- BLE HR Service: https://www.bluetooth.com/specifications/specs/heart-rate-service/
- BLE RSC Service: https://www.bluetooth.com/specifications/specs/running-speed-and-cadence-service/
- FIT SDK: https://developer.garmin.com/fit/overview/
- fit-file-writer: https://www.npmjs.com/package/fit-file-writer
- Tauri: https://tauri.app/

---

## 13. Agent Rules

1.  Keep changes surgical; do not add unrelated deps.
2.  Prefer client-side only; no server routes needed except Next.js static.
3.  Always handle BLE errors with user-visible messages.
4.  Mock mode: if `?mock=1` or no BLE, simulate HR 140-170, cadence 160-180, pace 5:30-6:00 for UI dev.
5.  Validate FIT with viewer before claiming done.
6.  Document `Virtual Run` requirement in UI help text.
