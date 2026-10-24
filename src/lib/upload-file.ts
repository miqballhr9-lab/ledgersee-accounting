import { getAttachmentUploadTarget } from "@/app/actions";

/**
 * Uploads a file from the browser and returns its address. With a Vercel Blob
 * store connected the file goes straight to Blob; otherwise it goes through the
 * platform's storage. Either way the bytes never pass through the app's server.
 *
 * Attachments go to the private store when one is connected and come back as an
 * /api/files/... address that opens only for people signed in to this business.
 * Pass "logo" for the company logo, which must stay public (shared invoices, emails).
 */
export async function uploadFile(file: File, purpose: "file" | "logo" = "file"): Promise<string> {
  const target = await getAttachmentUploadTarget(file.name, file.type, file.size, purpose);
  if (target.provider === "blob") {
    const { put } = await import("@vercel/blob/client");
    const result = await put(target.pathname, file, { access: target.access, token: target.clientToken, contentType: file.type || undefined });
    return target.access === "private" ? `/api/files/${result.pathname}` : result.url;
  }
  const response = await fetch(target.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  if (!response.ok) throw new Error("The upload didn’t finish. Please try again.");
  return target.publicUrl;
}
