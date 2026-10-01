/**
 * File storage — avatars, photos, attachments, anything that is not a database row.
 *
 * Already configured: no bucket to create, no keys to obtain.
 *
 * How it works, and why it is shaped this way: the browser uploads DIRECTLY to
 * storage using a one-shot link this module mints on the server. The file bytes
 * never pass through the app, so a 20 MB upload does not occupy a server request
 * for its whole duration, and the app never holds a storage credential that could
 * reach anything beyond its own files.
 *
 * Typical use — a server action mints the link, a client component uses it:
 *
 *   // src/app/actions.ts
 *   "use server";
 *   import { createUploadUrl } from "@/lib/storage";
 *   import { requireUser } from "@/lib/auth";
 *
 *   export async function startAvatarUpload(name: string, type: string) {
 *     await requireUser();                       // never mint links for strangers
 *     return createUploadUrl({ filename: name, contentType: type });
 *   }
 *
 *   // client component
 *   const target = await startAvatarUpload(file.name, file.type);
 *   await fetch(target.uploadUrl, {
 *     method: "PUT",
 *     headers: { "Content-Type": file.type },    // must match what was signed
 *     body: file,
 *   });
 *   // then save target.publicUrl on the user's row
 */
import "server-only";

export type UploadTarget = {
  /** One-shot PUT URL. Expires in minutes — mint it when the user is ready, not in advance. */
  uploadUrl: string;
  /** Where the file will be readable once uploaded. Store THIS, not the upload URL. */
  publicUrl: string;
  key: string;
  expiresIn: number;
};

/** File types storage accepts. Anything else is refused before a link is minted. */
export const ALLOWED_UPLOAD_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/csv",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
] as const;

/**
 * Mint an upload link for one file.
 *
 * ALWAYS check the caller is signed in and allowed to do this before calling —
 * an unguarded server action that returns upload URLs is an open write endpoint
 * on your storage.
 *
 * Uploaded files are PUBLIC once written: the returned URL is unguessable but not
 * secret. Do not use this for anything that must stay private (identity
 * documents, medical records); keep that kind of data in the database, behind a
 * permission check.
 *
 * Throws on refusal — an unsupported type or a storage outage is something the
 * calling flow needs to surface, not silently skip.
 */
export async function createUploadUrl(input: {
  filename: string;
  contentType: string;
  /** Size in bytes, when known. Lets an over-large file be refused before upload. */
  size?: number;
}): Promise<UploadTarget> {
  const base = process.env.IMAGINE_SERVICES_URL;
  const token = process.env.IMAGINE_APP_TOKEN;
  if (!base || !token) throw new Error("File storage is not available for this app.");

  const response = await fetch(`${base}/storage/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      filename: input.filename,
      content_type: input.contentType,
      size: input.size ?? 0,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const reason = await response.json().catch(() => null);
    const code = reason?.detail?.code ?? String(response.status);
    if (code === "unsupported_type") throw new Error("That file type isn't supported.");
    if (code === "too_large") throw new Error("That file is too large.");
    throw new Error("Couldn't prepare the upload. Please try again.");
  }

  const data = await response.json();
  return {
    uploadUrl: data.upload_url,
    publicUrl: data.public_url,
    key: data.key,
    expiresIn: data.expires_in,
  };
}
