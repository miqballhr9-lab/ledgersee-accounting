/**
 * Sign-in, browser side.
 *
 * This is the ONLY auth module a client component may import. `@/lib/auth` runs
 * on the server and holds the database connection; importing it from the browser
 * fails the build.
 *
 *   import { signIn, signOut, signUp, useSession } from "@/lib/auth-client";
 *
 * `useSession()` is for rendering — showing a name, hiding a button. It is not a
 * security boundary: anything the browser decides, the browser can be made to
 * decide differently. Every actual permission check belongs in the server action
 * (see `requireUser` in `@/lib/auth`).
 */
"use client";

import { createAuthClient } from "better-auth/react";
import { genericOAuthClient, magicLinkClient } from "better-auth/client/plugins";

import { describeAuthError } from "@/lib/errors";

export const authClient = createAuthClient({
  plugins: [magicLinkClient(), genericOAuthClient()],
});

export const {
  signIn,
  signOut,
  signUp,
  useSession,
  getSession,
  /**
   * Email another confirmation link to an address that has not been verified yet.
   *
   *   await sendVerificationEmail({ email, callbackURL: "/" });
   *
   * Every "check your inbox" screen needs this behind a button. Mail is the one
   * part of a sign-up that can fail AFTER the account already exists — a provider
   * blip, a full mailbox, an address typed one character wrong — and without a way
   * to ask again the person is stuck on a screen telling them to wait for
   * something that is never going to arrive. Sign-in itself still works; only the
   * verified flag is missing.
   */
  sendVerificationEmail,
} = authClient;

/**
 * Start "Continue with Google" — in a POPUP.
 *
 *   <button onClick={() => signInWithGoogle().then(() => router.refresh())}>
 *     Continue with Google
 *   </button>
 *
 * Why a popup and not a redirect: this app is shown inside an iframe (the preview,
 * and often when embedded). Google's consent page refuses to be framed, and a
 * full-page redirect would navigate the whole host page away. So the flow runs in
 * a separate popup window, and this resolves once it reports back — no password,
 * no setup, no keys. `after` is only used by the non-popup fallback below.
 *
 * The popup is opened SYNCHRONOUSLY on click (before any await) or the browser's
 * popup blocker kills it. When a blocker kills it anyway, we fall back to a
 * full-page redirect, which works when the app is NOT framed.
 *
 * After this resolves, refresh whatever renders the signed-in state (e.g.
 * `router.refresh()`, or `useSession`'s refetch) — the session cookie is now set.
 *
 * Only render the button when Google sign-in is actually configured: import
 * `googleSignInEnabled` from `@/lib/auth` in a SERVER component (the credentials
 * are server-only) and pass the result down.
 *
 * ── Handle the rejection ────────────────────────────────────────────────────────
 * This REJECTS when sign-in actually failed, and resolves when it succeeded or the
 * person simply closed the popup. Catch it and show `error.message`: it has already
 * been turned into a plain sentence by `describeAuthError`, so it is safe to render
 * as-is. Do not swallow it — the commonest real failure is an unconfirmed email
 * address, and the person needs to be told that or they will keep clicking a button
 * that silently does nothing.
 *
 *   try {
 *     await signInWithGoogle();
 *     router.refresh();
 *   } catch (e) {
 *     setError(e instanceof Error ? e.message : "Sign-in failed. Please try again.");
 *   }
 */
export async function signInWithGoogle(after: string = "/"): Promise<void> {
  // Open the popup to a page on THIS app's origin that starts the flow itself.
  // Running the whole flow inside the popup keeps it entirely first-party: the
  // state cookie Better Auth sets when starting and checks at the callback are
  // written and read in the same (top-level popup) context. Starting the flow
  // from the iframe instead would set that cookie third-party and the callback
  // would reject it. Opened synchronously (no await first) so the popup blocker
  // treats it as user-initiated.
  const start = `${window.location.origin}/auth/start?after=${encodeURIComponent(after)}`;
  const popup = window.open(start, "imagine-google-signin", "popup,width=480,height=640");

  // Popup blocked → run it in the current window. Correct when the app is NOT
  // framed; a framed app must allow popups for this button.
  if (!popup) {
    window.location.href = start;
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const done = (error?: string | null) => {
      clearInterval(timer);
      window.removeEventListener("message", onMessage);
      try {
        popup.close();
      } catch {
        /* already closed */
      }
      // `/auth/complete` reports the reason when the flow was refused. Translate it
      // here so every caller gets a sentence it can render, and reject rather than
      // resolve — a failed sign-in that resolves is indistinguishable from a
      // successful one, which is how a real failure ends up showing the person
      // nothing at all.
      if (error) {
        const { message, cause } = describeAuthError(error);
        console.error("[auth] sign-in failed: %s", cause);
        reject(new Error(message));
        return;
      }
      resolve();
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === "imagine-oauth-complete") {
        done(e.data.error);
      }
    };
    // Also resolve if the user simply closes the popup. A cancel is not a failure —
    // the caller refetches the session, finds nothing, and leaves the form as it was.
    const timer = window.setInterval(() => {
      if (popup.closed) done();
    }, 500);
    window.addEventListener("message", onMessage);
  });
}
