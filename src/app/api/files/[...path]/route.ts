import { get } from "@vercel/blob";

import { getWorkspaceUser } from "@/lib/auth";
import { privateBlobToken } from "@/lib/storage";

/**
 * Opens a private file (receipt, HR document, CV, attachment) for someone signed
 * in to the business that owns it. Every file lives under its business's id, so
 * the first part of the path must be the signed-in person's business. Anyone
 * else, signed in or not, gets a plain 404 that says nothing about the file.
 */
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const token = privateBlobToken();
  if (!token) return notFound();
  const { path } = await params;
  if (!path?.length || path.some((part) => !part || part === "." || part === "..")) return notFound();
  const me = await getWorkspaceUser();
  if (!me) return new Response("Please sign in to open this file.", { status: 401, headers: { "Cache-Control": "no-store" } });
  if (path[0] !== me.id) return notFound();

  const result = await get(path.join("/"), { access: "private", token, ifNoneMatch: request.headers.get("if-none-match") ?? undefined }).catch(() => null);
  if (!result) return notFound();
  const headers = new Headers({
    // Only this person's browser may keep it, and only briefly.
    "Cache-Control": "private, max-age=300",
    ETag: result.blob.etag,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": result.blob.contentDisposition || "inline",
  });
  if (result.statusCode === 304) return new Response(null, { status: 304, headers });
  const contentType = result.blob.contentType || "application/octet-stream";
  headers.set("Content-Type", contentType);
  // A file is shown, never run. PDFs are left to the browser's own viewer, which a sandbox would block.
  if (contentType !== "application/pdf") headers.set("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");
  headers.set("Content-Length", String(result.blob.size));
  return new Response(result.stream, { status: 200, headers });
}
