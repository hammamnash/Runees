# Runees — Treadmill HR / Pace / Cadence Monitor

Live treadmill dashboard for **Garmin Forerunner (Virtual Run)** via Bluetooth LE. Shows HR, pace, cadence, distance, timer. Records and exports **.FIT** for Garmin Connect.

## Quick Start (Windows, Chrome/Edge)

```bash
npm install
npm run dev
# open http://localhost:3000
```

1. On watch: **Menu > Sensors > Virtual Run** (not Broadcast HR)
2. Click **Connect Garmin** ? pick device
3. **Start** to record, **Stop** ? **Download .FIT** ? import at https://connect.garmin.com/modern/import-data

> Use `http://localhost:3000` (secure context). `http://192.168.x.x` will fail for Web Bluetooth. Mock mode: `?mock=1` or toggle Mock.

## Stack

Next.js 14 + Tailwind + Web Bluetooth (0x180D HR, 0x1814 RSC) + custom FIT encoder. No backend.

## Scripts

- `npm run dev` — localhost:3000
- `npm run build` — production build
- `npm run lint` — eslint

## FIT

Generates valid FIT Activity (FileId/Activity/Session/Lap/Record) — validated for Garmin Connect import.

## Phase 2

Tauri portable .exe wrapper (same web build).
