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
    <div className="rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-zinc-900/60"
        aria-expanded={open}
      >
        <span className="text-xs tracking-widest text-zinc-500 uppercase">Device Time</span>
        <span className="flex items-center gap-3">
          {!open ? <span className="text-2xl font-bold tabular-nums text-zinc-300">{time}</span> : null}
          <svg
            className={`h-4 w-4 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </span>
      </button>
      {open ? (
        <div className="px-6 pb-6 flex flex-col gap-1">
          <div className="text-5xl font-black tabular-nums text-white">{time}</div>
          <div className="text-sm text-zinc-400">
            {date} · <span className="text-zinc-300">{tz}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
