/**
 * Transactional email — sign-in links, password resets, receipts, notifications.
 *
 * Already configured: there is no key to obtain and no domain to verify. Mail
 * goes out through the platform's verified sender, which is also why this is not
 * a bulk channel — newsletters and marketing blasts do not belong here and will
 * be rate-limited.
 *
 * Server-only. It uses a credential that must never reach the browser, so call it
 * from a server action, a server component, or `@/lib/auth`.
 */
import "server-only";

type SendEmail = {
  to: string;
  subject: string;
  /** HTML body. A plain-text alternative is generated automatically. */
  html: string;
  replyTo?: string;
  /** Your app's name, shown as the sender. Defaults to NEXT_PUBLIC_APP_NAME.
   *  The sending address itself is fixed by the platform and can't be changed. */
  fromName?: string;
};

/**
 * Send one email. Resolves `false` instead of throwing when sending fails.
 *
 * Deliberate: the caller is usually mid-flow ("create the account, then email
 * them"), and a provider blip should not roll back work the user has already
 * completed. Check the result if the email IS the outcome — a magic link that
 * silently never arrives looks to the user like a broken sign-in.
 */
/**
 * Send, or throw.
 *
 * Use this whenever the email IS the outcome — a sign-in link, a password reset,
 * anything where the user is now looking at "check your email". `sendEmail`
 * returning `false` there is worse than an error: the UI reports success, no
 * message arrives, and the user cannot tell the difference between a slow inbox
 * and a broken app. Better to fail loudly and let them retry.
 */
export async function sendEmailOrThrow(input: SendEmail): Promise<void> {
  const sent = await sendEmail(input);
  if (!sent) {
    throw new Error(
      "Couldn't send that email just now. Please try again in a moment.",
    );
  }
}

export async function sendEmail({
  to,
  subject,
  html,
  replyTo,
  fromName,
}: SendEmail): Promise<boolean> {
  const base = process.env.IMAGINE_SERVICES_URL;
  const token = process.env.IMAGINE_APP_TOKEN;
  if (!base || !token) {
    console.error("[email] not configured — message to %s not sent", to);
    return false;
  }

  const body = JSON.stringify({
    token,
    to,
    subject,
    html,
    reply_to: replyTo,
    app_name: fromName ?? process.env.NEXT_PUBLIC_APP_NAME ?? "",
  });

  // Two attempts. The platform already retries its own hop to the mail provider,
  // so this only covers the leg between this app and the platform — a dropped
  // connection or a restarting instance. Kept short because a person is waiting
  // on the response behind a "check your email" screen.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt) await new Promise((r) => setTimeout(r, 400));
    try {
      const response = await fetch(`${base}/email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        cache: "no-store",
      });
      if (response.ok) return true;

      // Never log the body: it can echo the recipient address back.
      // 4xx (except 429) is a verdict on this message — a bad address, a body over
      // the size limit. It will fail identically on every retry, so stop.
      if (response.status < 500 && response.status !== 429) {
        console.error(
          "[email] rejected (%s) for subject %j — not retrying",
          response.status,
          subject,
        );
        return false;
      }
      console.error("[email] send failed (%s), attempt %s", response.status, attempt + 1);
    } catch (error) {
      console.error("[email] send error (attempt %s):", attempt + 1, error);
    }
  }
  return false;
}
