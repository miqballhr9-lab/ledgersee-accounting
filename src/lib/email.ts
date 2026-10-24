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
import nodemailer from "nodemailer";

import { ActionError } from "@/lib/action-error";

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
    throw new ActionError(
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
  const smtp = smtpSettings();
  if (smtp) return sendBySmtp(smtp, { to, subject, html, replyTo, fromName });
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

interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/**
 * Your own mailbox as the sender, when it is set up: a Gmail address with an
 * app password (GMAIL_USER, GMAIL_APP_PASSWORD), or any SMTP server (SMTP_HOST,
 * SMTP_PORT, SMTP_USER, SMTP_PASS, optional SMTP_FROM). Without either, mail goes
 * through the platform as before.
 */
export function smtpSettings(): SmtpSettings | null {
  const gmailUser = process.env.GMAIL_USER?.trim();
  const gmailPass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (gmailUser && gmailPass) return { host: "smtp.gmail.com", port: 465, user: gmailUser, pass: gmailPass, from: gmailUser };
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  if (host && user && pass) return { host, port: Number(process.env.SMTP_PORT) || 465, user, pass, from: process.env.SMTP_FROM?.trim() || user };
  return null;
}

/** Whether any way of sending email is set up. */
export function emailConfigured() {
  return Boolean(smtpSettings() || (process.env.IMAGINE_SERVICES_URL && process.env.IMAGINE_APP_TOKEN));
}

/**
 * Checks the mailbox settings by signing in to the mail server, without sending
 * anything. Returns null when it works, or a plain reason to show the owner.
 */
export async function checkEmailSetup(): Promise<string | null> {
  const settings = smtpSettings();
  if (!settings) return emailConfigured() ? null : "Email isn't set up: GMAIL_USER and GMAIL_APP_PASSWORD aren't in this deployment. Add them in Vercel → Settings → Environment Variables (Production), then redeploy.";
  const transport = nodemailer.createTransport({ host: settings.host, port: settings.port, secure: settings.port === 465, auth: { user: settings.user, pass: settings.pass }, connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
  try {
    await transport.verify();
    return null;
  } catch (error) {
    const code = (error as { code?: string })?.code ?? "";
    console.error("[email] smtp check failed (%s)", code || "unknown");
    if (code === "EAUTH") return `Gmail refused the sign-in for ${settings.user}. The app password is wrong or was deleted: make a new one at myaccount.google.com/apppasswords, put it in GMAIL_APP_PASSWORD, and redeploy. GMAIL_USER must be the same Gmail address the app password was made in.`;
    if (["ETIMEDOUT", "ESOCKET", "ECONNECTION", "EDNS"].includes(code)) return "The mail server couldn't be reached. Try again in a minute.";
    return `Email couldn't be sent (${code || "unknown error"}). Check GMAIL_USER and GMAIL_APP_PASSWORD in Vercel.`;
  }
}

async function sendBySmtp(settings: SmtpSettings, { to, subject, html, replyTo, fromName }: SendEmail): Promise<boolean> {
  const transport = nodemailer.createTransport({ host: settings.host, port: settings.port, secure: settings.port === 465, auth: { user: settings.user, pass: settings.pass }, connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
  const name = (fromName ?? process.env.NEXT_PUBLIC_APP_NAME ?? "MIK LEDGER").replace(/["<>]/g, "").trim() || "MIK LEDGER";
  try {
    await transport.sendMail({ from: `"${name}" <${settings.from}>`, to, subject, html, replyTo, text: html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\n{3,}/g, "\n\n").trim() });
    return true;
  } catch (error) {
    // Never log the message or the password; the code says enough (EAUTH is a wrong app password).
    console.error("[email] smtp send failed (%s)", (error as { code?: string })?.code ?? "unknown");
    return false;
  }
}
