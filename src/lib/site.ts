import { headers } from "next/headers";

// Resolve ONE base URL at runtime. The app has no fixed domain at build time —
// the platform assigns one at publish. Never hardcode a literal domain.
export async function siteUrl(): Promise<string> {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl) return envUrl;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";

  if (host) return `${proto}://${host}`;
  return "http://localhost:3000";
}
