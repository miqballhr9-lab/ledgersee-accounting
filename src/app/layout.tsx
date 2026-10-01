import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

// You MAY adjust the metadata and add fonts to match your design.
// NEVER next/font/google — the build sandbox has no Google egress, so the fetch
// hangs at compile and the preview renders blank. Use the zero-network stack in
// globals.css, or self-host a .woff2 via next/font/local.
export const metadata: Metadata = {
  title: "App",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        {children}
        {/* Imagine Make preview runtime — only active when framed by the editor. */}
        <Script
          src="https://cdn-chatly.vyro.ai/chatly-make/sites-script/make-preview-runtime.js"
          strategy="afterInteractive"
        />
        {/* Imagine preview heading override — only active when framed. */}
        <Script
          src="https://cdn-chatly.vyro.ai/chatly-make/sites-script/heading-override.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
