"use client";
import { useEffect, useState } from "react";

function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
  } catch {
    return "Local time";
  }
}

export function ClockCard() {
  const [open, setOpen] = useState(true);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [tz, setTz] = useState("Local time");

  useEffect(() => {
    setTz(getDeviceTimeZone());
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const time =
    nowMs != null
      ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(nowMs)
      : "--:--:--";
  const date =
    nowMs != null
      ? new Intl.DateTimeFormat(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" }).format(nowMs)
      : "";

  return (
    <div className="overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full py-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center justify-between">
          <span className="eyebrow !text-ash">Device Time</span>
          <span className="flex items-center gap-4">
            {!open ? <span className="metric-num text-3xl text-mist">{time}</span> : null}
            <svg
              className={`h-4 w-4 text-ash transition-transform ${open ? "rotate-180" : ""}`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden
            >
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </span>
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-1 pt-4">
          <div className="metric-num text-6xl text-white lg:text-7xl">{time}</div>
          <div className="text-body-light text-sm text-ash">
            {date} · <span className="text-mist">{tz}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
