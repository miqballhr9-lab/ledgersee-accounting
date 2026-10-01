/**
 * Where the Google sign-in popup lands when the flow ends — successfully or not.
 *
 * On success Better Auth has already set the session cookie on this app's origin
 * during the callback, so this page's only job is to tell the window that opened it
 * ("Continue with Google" in `@/lib/auth-client`) to stop waiting, then close.
 *
 * It handles FAILURE too, which is the less obvious half. `/auth/start` points
 * `errorCallbackURL` here as well, so a refused sign-in arrives as `?error=<code>`
 * instead of stranding the popup on a generic error page outside the app. The code
 * is passed to the opener, which turns it into a sentence with `describeAuthError`.
 * Without this the popup would close on its own and the app could not distinguish a
 * failed sign-in from someone changing their mind — so it would show nothing at all.
 *
 * Do not delete this route, and keep reporting failures: silence here is invisible
 * everywhere else.
 */
"use client";

import { useEffect, useState } from "react";

import { describeAuthError } from "@/lib/errors";

export default function AuthComplete() {
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const after = params.get("after") || "/";
    // Better Auth reports the reason as `error`, with a longer note in
    // `error_description` when it has one (see dist/oauth2/errors.mjs).
    const error = params.get("error") || params.get("error_description");

    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: "imagine-oauth-complete", error: error ?? null },
        window.location.origin,
      );
      window.close();
      // Some browsers refuse to close a tab that script didn't open in the same
      // gesture. If we're still here shortly, stay put on a failure so the message
      // is readable, and continue on success.
      window.setTimeout(() => {
        if (error) setFailure(describeAuthError(error).message);
        else window.location.replace(after);
      }, 400);
      return;
    }

    // No opener: the popup was blocked and the flow ran in the main window. There
    // is nobody to report to, so show the outcome here.
    if (error) {
      const { message, cause } = describeAuthError(error);
      console.error("[auth] sign-in failed: %s", cause);
      setFailure(message);
      return;
    }
    window.location.replace(after);
  }, []);

  return (
    <main
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "100vh",
        padding: "1.5rem",
        textAlign: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {failure ? (
        <div style={{ maxWidth: "26rem", display: "grid", gap: "1rem" }}>
          <p style={{ margin: 0 }}>{failure}</p>
          <a href="/" style={{ color: "inherit" }}>
            Back to the app
          </a>
        </div>
      ) : (
        <p>You&rsquo;re signed in — you can close this window.</p>
      )}
    </main>
  );
}
