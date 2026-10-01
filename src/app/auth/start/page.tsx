/**
 * Starts Google sign-in from INSIDE the popup that `signInWithGoogle` opens.
 *
 * Why this exists as its own page rather than starting the flow from the button:
 * the app runs in an iframe, and Better Auth sets a short-lived state cookie when
 * a sign-in begins and re-checks it at the callback. Starting here — top-level in
 * the popup — keeps both the setting and the checking first-party, so the state
 * matches. Starting from the framed button would write that cookie in a
 * third-party context and the callback would reject it.
 *
 * This redirects the popup to Google immediately; it renders only a brief holding
 * message. Do not delete it — `signInWithGoogle` opens the popup here.
 */
"use client";

import { useEffect } from "react";

import { authClient } from "@/lib/auth-client";

export default function AuthStart() {
  useEffect(() => {
    const after = new URLSearchParams(window.location.search).get("after") || "/";
    // Default (redirect) mode: sets the state cookie first-party and navigates
    // this popup to Google. On return it lands on /auth/complete, which signals
    // the opener and closes.
    const complete = `${window.location.origin}/auth/complete?after=${encodeURIComponent(after)}`;
    void authClient.signIn.oauth2({
      providerId: "imagine",
      callbackURL: complete,
      // Send FAILURES back to our own page too. Without this they land on Better
      // Auth's built-in error page, which lives outside this app: the popup would
      // sit there showing a raw code like `account_not_linked` while the opener,
      // seeing only that the window eventually closed, carried on as if sign-in had
      // merely been cancelled. The person is told nothing and the app never learns
      // anything failed. `/auth/complete` reads the `?error=` parameter and reports
      // it to the opener.
      errorCallbackURL: complete,
    });
  }, []);

  return (
    <main
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "100vh",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <p>Redirecting to Google&hellip;</p>
    </main>
  );
}
