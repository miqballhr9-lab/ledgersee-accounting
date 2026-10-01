import type { NextConfig } from "next";

// X-Frame-Options ALLOWALL lets the platform embed the live preview in an iframe.
// Keep this — removing it breaks the preview pane.
const nextConfig: NextConfig = {
  // Google fetches /google<token>.html to verify this app's Search Console
  // property. The path is whatever Google issued, so it is read from the
  // environment rather than hardcoded, and no rewrite exists until one is.
  async rewrites() {
    const token = process.env.GSC_SITE_VERIFICATION_TOKEN;
    if (!token) return [];
    return [{ source: `/${token}`, destination: "/api/site-verification" }];
  },

  // The preview is served from a tunnel hostname, not localhost — and Next 16
  // BLOCKS cross-origin requests to dev-only assets and endpoints by default.
  // The casualty is the HMR websocket: the upgrade is refused, the dev client
  // waits on a socket that never opens, and hydration therefore never runs. The
  // page renders perfectly from the server and then NOTHING is clickable, with
  // no console error and no failed request to explain it — because nothing
  // crashed, the client runtime simply never started. `afterInteractive` scripts
  // die the same way.
  //
  // Next 15 only warned about this, which is why it surfaced the moment the
  // template moved to 16. Both entries are needed: the wildcard matches a single
  // label, so `*.modal.host` alone does not cover the `.w.` in a preview host.
  allowedDevOrigins: ["*.modal.host", "*.w.modal.host"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [{ key: "X-Frame-Options", value: "ALLOWALL" }],
      },
    ];
  },
};

export default nextConfig;
