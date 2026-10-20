import type { MetadataRoute } from "next";

/**
 * Makes MIK LEDGER installable on phones: added to the home screen it opens
 * full screen on the employee portal (check in/out, time off, payslips).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MIK LEDGER",
    short_name: "MIK LEDGER",
    description: "Check in and out, ask for time off, see your leave balance and payslips.",
    id: "/app/my",
    start_url: "/app/my",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#1E6A96",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Check in / out", url: "/app/my#check-in" },
      { name: "Time off", url: "/app/my#time-off" },
    ],
  };
}
