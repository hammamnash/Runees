// Diagnose why Web Bluetooth is unavailable, so the UI can show an actionable
// message instead of a generic "not supported" banner.
//
// Web Bluetooth requires BOTH:
//  1. A browser that implements it (Chromium: Chrome/Edge/Samsung Internet).
//     - iOS: every browser (incl. Chrome) uses WebKit -> never supported.
//  2. A secure context: https:// or localhost. Plain http:// over LAN IP
//     (e.g. http://192.168.x.x:3000) does NOT expose navigator.bluetooth.

export type BleSupportReason =
  | "supported"
  | "insecure-context"
  | "ios"
  | "unsupported-browser";

export function getBleSupportReason(): BleSupportReason {
  if (typeof navigator === "undefined") return "unsupported-browser";
  if ("bluetooth" in navigator) return "supported";
  // navigator.bluetooth missing — figure out why.
  const isSecure =
    typeof window !== "undefined" &&
    (window.isSecureContext ||
      location.protocol === "https:" ||
      ["localhost", "127.0.0.1"].includes(location.hostname));
  if (!isSecure) return "insecure-context";
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) return "ios";
  return "unsupported-browser";
}

export const BLE_SUPPORT_MESSAGES: Record<BleSupportReason, string | null> = {
  supported: null,
  "insecure-context":
    "Web Bluetooth needs HTTPS. Open via https:// or localhost — http://192.168.x.x won't work.",
  ios: "Web Bluetooth is unavailable on iOS (all browsers use WebKit). Use an Android phone or desktop Chrome/Edge.",
  "unsupported-browser":
    "This browser doesn't support Web Bluetooth. Use Chrome or Edge.",
};
