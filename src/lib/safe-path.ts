/**
 * A path on this site to go to after signing in, or "/". Anything else —
 * another site, `//host`, `javascript:` — is refused, so a link someone is sent
 * can't run script here or bounce them to a look-alike page.
 */
export function safeAfterPath(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!/^\/(?![/\\])/.test(value) || /[\u0000-\u001f\\]/.test(value)) return "/";
  return value;
}
