import { NextResponse } from "next/server";

// Google verifies this app by fetching /google<token>.html and reading the token
// back out of the body. `next.config.ts` rewrites that path here, so the token
// never has to exist as a file — a file in public/ is one tidy-up away from
// silently un-verifying the property, with nothing to report that it happened.
//
// Managed by the platform. Deleting this un-verifies the app's Search Console
// property and its search data stops being readable.
export const dynamic = "force-dynamic";

export function GET() {
  const token = process.env.GSC_SITE_VERIFICATION_TOKEN;
  if (!token) {
    return new NextResponse("Not Found", { status: 404 });
  }
  return new NextResponse(`google-site-verification: ${token}`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
