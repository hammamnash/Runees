import withPWA from "next-pwa";

const pwa = withPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
});

/** @type {import(''next'').NextConfig} */
const nextConfig = {
  output: process.env.TAURI_BUILD ? "export" : undefined,
};

export default pwa(nextConfig);
