/**
 * Turn a failure into a sentence a real person can act on.
 *
 * Every error this app shows a visitor goes through here. Not as a style rule —
 * the alternative is what the underlying libraries actually produce, which is a
 * machine code (`account_not_linked`), a driver message ("No transactions support
 * in neon-http driver"), or a stack trace. Shown to somebody trying to sign up,
 * all three read the same way: the app is broken and it is their problem.
 *
 * Two things this must never do:
 *
 *   1. Name the machinery. Not the database vendor, not the auth library, not a
 *      table, a column, a driver or a connection string. The person using this app
 *      did not choose any of it and cannot act on knowing it. The app's owner
 *      didn't choose it either.
 *   2. Send them somewhere else. No "see the docs", no provider dashboard, no
 *      config snippet. If the resolution needs the owner, the message says the
 *      owner is looking into it — it does not hand a visitor a support ticket for
 *      a system they have never heard of.
 *
 * What it SHOULD do is say what happened, whether their work survived, and what to
 * try next — in that order, in one or two sentences.
 *
 * ── For whoever is reading this while debugging ──────────────────────────────────
 * The plain sentence is for the visitor. It is not a substitute for diagnosis:
 * `describeAuthError` also returns a stable `code` and a `cause` explaining the
 * real reason, so the app's own logs (and the agent that builds it) keep the full
 * picture. Log `cause`, render `message`.
 */

/** What to show, plus enough context to debug without leaking it to the screen. */
export interface FriendlyError {
  /** The sentence to render. Safe for any audience. */
  message: string;
  /** Stable identifier for logs and for branching in UI. Never rendered raw. */
  code: string;
  /**
   * Why this really happened, in developer terms. Log it, or surface it to the
   * app's owner in a build tool — never to a visitor.
   */
  cause: string;
  /**
   * True when the person can fix this themselves by doing something different
   * (wrong password, weak password, email needs confirming). False when it needs
   * the owner or a retry — those get a calmer, less blame-shaped message.
   */
  actionable: boolean;
}

/**
 * Auth failures, keyed by what Better Auth actually emits.
 *
 * Two casings on purpose, because there are two delivery paths and they differ:
 *
 *   `INVALID_EMAIL_OR_PASSWORD` — a thrown API error's `code`, from a direct call
 *      like `signIn.email(...)`. Read it off `error.code` in the response.
 *   `account_not_linked`        — an OAuth callback failure, which cannot throw:
 *      the browser is mid-redirect. Better Auth lowercases the reason, swaps
 *      spaces for underscores, and appends it as `?error=` on the error page
 *      (`dist/oauth2/errors.mjs`). Both land in the same `error` parameter, which
 *      is why one lookup has to cover both shapes.
 *
 * Codes were taken from the installed package, not from the documentation — the
 * docs disagree with the shipped source on when `account_not_linked` fires. See
 * the note in `@/lib/auth`.
 */
const AUTH_ERRORS: Record<string, Omit<FriendlyError, "code">> = {
  // ── Sign-in and sign-up ────────────────────────────────────────────────────────
  INVALID_EMAIL_OR_PASSWORD: {
    message: "That email or password doesn't match an account. Please try again.",
    cause:
      "Credentials rejected. Deliberately does not say WHICH half was wrong — that " +
      "would confirm to a stranger that an address has an account here.",
    actionable: true,
  },
  INVALID_PASSWORD: {
    message: "That password isn't right. Please try again.",
    cause: "Password mismatch on an account that exists (e.g. a re-authentication step).",
    actionable: true,
  },
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: {
    message: "There's already an account with that email. Try signing in instead.",
    cause: "Sign-up attempted with an address that already has an account.",
    actionable: true,
  },
  USER_NOT_FOUND: {
    message: "We couldn't find an account with that email.",
    cause: "No user row for the address supplied.",
    actionable: true,
  },
  USER_EMAIL_NOT_FOUND: {
    message: "We couldn't find an account with that email.",
    cause: "No user row for the address supplied.",
    actionable: true,
  },
  INVALID_EMAIL: {
    message: "That doesn't look like a valid email address.",
    cause: "Address failed format validation before any lookup.",
    actionable: true,
  },
  PASSWORD_TOO_SHORT: {
    message: "Please choose a password with at least 8 characters.",
    cause: "Below `emailAndPassword.minPasswordLength` (8).",
    actionable: true,
  },
  PASSWORD_TOO_LONG: {
    message: "That password is too long — please choose a shorter one.",
    cause: "Above Better Auth's maximum password length.",
    actionable: true,
  },
  PASSWORD_ALREADY_SET: {
    message: "This account already has a password. Sign in with it, or reset it instead.",
    cause: "Set-password called on an account that already has credentials.",
    actionable: true,
  },
  CREDENTIAL_ACCOUNT_NOT_FOUND: {
    message:
      "This account doesn't have a password yet — sign in the way you did the first " +
      "time, or reset your password to set one.",
    cause:
      "User exists but has no credential account row: they registered via the sign-in " +
      "provider, so there is no password to check.",
    actionable: true,
  },

  // ── Account linking ────────────────────────────────────────────────────────────
  //
  // The one that prompted all of this. It is NOT a misconfiguration — see the long
  // note in `@/lib/auth`. It fires when someone signed up with a password, never
  // confirmed their address, and is now returning via the sign-in provider. The
  // route forward is confirming the address, so the message says so and the UI
  // should offer to resend. Never tell them to "enable account linking".
  account_not_linked: {
    message:
      "That email is already registered, but it hasn't been confirmed yet. Check your " +
      "inbox for the confirmation link — then you'll be able to sign in this way.",
    cause:
      "Implicit OAuth linking refused because the existing local user row has " +
      "emailVerified = false (accountLinking.requireLocalEmailVerified, default true). " +
      "Correct behaviour: it stops an attacker who pre-registered an unverified " +
      "account at this address from capturing the real owner's identity. Resolves " +
      "itself once the address is confirmed. Do NOT disable the gate.",
    actionable: true,
  },
  unable_to_link_account: {
    message: "We couldn't finish connecting that sign-in method. Please try again.",
    cause: "linkAccount() threw while writing the account row.",
    actionable: false,
  },
  FAILED_TO_UNLINK_LAST_ACCOUNT: {
    message: "This is your only way to sign in, so it can't be removed.",
    cause: "Unlink refused: it would leave the user with no credentials at all.",
    actionable: true,
  },
  ACCOUNT_NOT_FOUND: {
    message: "That sign-in method isn't connected to your account.",
    cause: "No account row for the requested provider.",
    actionable: true,
  },

  // ── Email confirmation ─────────────────────────────────────────────────────────
  EMAIL_NOT_VERIFIED: {
    message:
      "Please confirm your email address first — check your inbox for the link, or " +
      "ask for a new one.",
    cause: "Route requires emailVerified. Always pair this with a resend control.",
    actionable: true,
  },
  EMAIL_ALREADY_VERIFIED: {
    message: "Your email is already confirmed — you're all set.",
    cause: "Verification attempted on an already-verified address.",
    actionable: true,
  },
  VERIFICATION_EMAIL_NOT_ENABLED: {
    message: "We can't send confirmation emails just now. You can still use your account.",
    cause:
      "emailVerification.sendVerificationEmail is not configured. Owner-side problem — " +
      "never blame the visitor, and never block them on it.",
    actionable: false,
  },
  TOKEN_EXPIRED: {
    message: "That link has expired. Ask for a new one and it'll work.",
    cause: "Verification or reset token past its expiry.",
    actionable: true,
  },
  INVALID_TOKEN: {
    message: "That link isn't valid any more. Ask for a new one and it'll work.",
    cause: "Token missing, malformed, or already consumed (they are single-use).",
    actionable: true,
  },

  // ── Sessions ───────────────────────────────────────────────────────────────────
  SESSION_EXPIRED: {
    message: "You've been signed out. Please sign in again to continue.",
    cause: "Session past `session.expiresIn` (7 days).",
    actionable: true,
  },
  SESSION_NOT_FRESH: {
    message: "Please confirm it's you by signing in again before making this change.",
    cause:
      "Sensitive operation on a session older than `freshAge`. Re-authentication, not " +
      "an error.",
    actionable: true,
  },
  NOT_SIGNED_IN: {
    message: "Please sign in to continue.",
    cause: "requireUser() found no session. Thrown by design rather than returning null.",
    actionable: true,
  },

  // ── Origin and callback rejections ─────────────────────────────────────────────
  //
  // Owner-side every time. A visitor can do nothing about a host list, so they get
  // a plain "something's wrong at our end" while the real reason goes to `cause`.
  INVALID_ORIGIN: {
    message: "Sign-in isn't working from this address just yet. The app's owner is on it.",
    cause:
      "Request origin absent from the trusted list. In this app that list comes from " +
      "IMAGINE_AUTH_HOSTS, refreshed each turn — a stale or missing value is the usual " +
      "reason. If this appears everywhere, the environment did not load.",
    actionable: false,
  },
  MISSING_OR_NULL_ORIGIN: {
    message: "Sign-in isn't working from this address just yet. The app's owner is on it.",
    cause: "No Origin header on a request that requires one.",
    actionable: false,
  },
  INVALID_CALLBACK_URL: {
    message: "Sign-in couldn't complete. Please try again.",
    cause: "callbackURL not on a trusted host.",
    actionable: false,
  },
  INVALID_REDIRECT_URL: {
    message: "Sign-in couldn't complete. Please try again.",
    cause: "redirectURL not on a trusted host.",
    actionable: false,
  },
  CROSS_SITE_NAVIGATION_LOGIN_BLOCKED: {
    message: "Please open the app in its own tab to sign in.",
    cause:
      "Top-level cross-site navigation blocked. Expected when framed — this is why " +
      "sign-in runs in a popup (see signInWithGoogle).",
    actionable: true,
  },

  // ── Provider / relay ───────────────────────────────────────────────────────────
  PROVIDER_NOT_FOUND: {
    message: "That sign-in option isn't available right now. You can still use a password.",
    cause:
      "Provider id not configured. Usually means the platform's sign-in credentials " +
      "are absent, so the button should have been hidden — check `googleSignInEnabled`.",
    actionable: false,
  },
  FAILED_TO_GET_USER_INFO: {
    message: "We couldn't get your details from that sign-in service. Please try again.",
    cause: "userInfo endpoint failed or returned an unusable payload.",
    actionable: false,
  },
  ID_TOKEN_NOT_SUPPORTED: {
    message: "That sign-in method isn't supported here.",
    cause: "id_token sign-in attempted against a provider without it configured.",
    actionable: false,
  },
  signup_disabled: {
    message: "New accounts aren't being created at the moment.",
    cause: "disableSignUp / disableImplicitSignUp refused a first-time sign-in.",
    actionable: false,
  },

  // ── Server-side failures ───────────────────────────────────────────────────────
  FAILED_TO_CREATE_USER: {
    message: "We couldn't create your account just now. Please try again in a moment.",
    cause: "User insert failed — most often the database being unreachable.",
    actionable: false,
  },
  FAILED_TO_CREATE_SESSION: {
    message: "We couldn't finish signing you in. Please try again in a moment.",
    cause: "Session insert failed after the account was verified.",
    actionable: false,
  },
  FAILED_TO_UPDATE_USER: {
    message: "We couldn't save that change. Please try again.",
    cause: "User update failed.",
    actionable: false,
  },
  FAILED_TO_GET_SESSION: {
    message: "We couldn't check whether you're signed in. Please try again.",
    cause: "Session read failed — usually the database being unreachable.",
    actionable: false,
  },
  internal_server_error: {
    message: "Something went wrong at our end. Please try again in a moment.",
    cause:
      "Unhandled server error. In the OAuth callback this specifically means the user " +
      "lookup query failed, i.e. the database was unreachable.",
    actionable: false,
  },
};

/** Shown when nothing matches. Says the true amount: something failed, try again. */
const UNKNOWN: Omit<FriendlyError, "code"> = {
  message: "Something went wrong. Please try again.",
  cause: "Unrecognised error. Log the raw value and add it to AUTH_ERRORS.",
  actionable: false,
};

/**
 * Pull whatever identifying string an error is carrying.
 *
 * Deliberately generous about shape. The same logical failure arrives as a thrown
 * `APIError` with `.body.code`, a client response with `.error.code`, a bare string
 * from a `?error=` parameter, or an `Error` whose message is all there is. A lookup
 * that only understood one of those would silently fall through to UNKNOWN for the
 * others — which looks exactly like the bug this module exists to fix.
 */
function extractCode(input: unknown): string | undefined {
  if (!input) return undefined;
  if (typeof input === "string") return input.trim() || undefined;

  const source = input as Record<string, any>;
  const candidate =
    source.code ??
    source.body?.code ??
    source.error?.code ??
    source.error ??
    source.statusText;

  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  if (input instanceof Error && input.message.trim()) return input.message.trim();
  return undefined;
}

/**
 * Translate any auth failure into something worth showing someone.
 *
 *   const { message, cause } = describeAuthError(error);
 *   console.error("[auth] %s", cause);   // for you
 *   setFormError(message);               // for them
 *
 * Accepts a thrown error, a client `{ error }` payload, or the raw `?error=` value
 * from a callback redirect. Never throws and never returns an empty message, so it
 * is safe in a `catch` — a translator that can itself fail is worse than none.
 */
export function describeAuthError(input: unknown): FriendlyError {
  const raw = extractCode(input);
  if (!raw) return { ...UNKNOWN, code: "unknown" };

  // Exact match first: codes arrive UPPER_SNAKE when thrown and lower_snake when
  // they come back as a redirect parameter, and both are real.
  const direct = AUTH_ERRORS[raw] ?? AUTH_ERRORS[raw.toUpperCase()] ?? AUTH_ERRORS[raw.toLowerCase()];
  if (direct) return { ...direct, code: raw };

  // A message rather than a code — "account not linked" before it gets underscored,
  // or a sentence with the code embedded. Normalise and try once more.
  const normalised = raw.toLowerCase().replace(/[\s-]+/g, "_");
  const viaMessage = AUTH_ERRORS[normalised] ?? AUTH_ERRORS[normalised.toUpperCase()];
  if (viaMessage) return { ...viaMessage, code: normalised };

  return { ...UNKNOWN, code: raw };
}

/**
 * The same treatment for everything that is not sign-in: a query, an upload, an
 * email send.
 *
 * These have no error codes to key off — a database that has gone away throws
 * whatever the driver felt like saying, and driver text is the most likely thing to
 * name the vendor in front of a visitor. So this classifies by symptom and returns
 * a written sentence, never the original string.
 *
 *   catch (e) {
 *     console.error(e);                                  // keep the real one
 *     return { error: describeDataError(e).message };    // show the safe one
 *   }
 *
 * `context` tunes the wording: "saving" and "loading" deserve different reassurance
 * about whether the person's work survived.
 */
export function describeDataError(
  input: unknown,
  context: "loading" | "saving" | "uploading" | "email" = "loading",
): FriendlyError {
  const text = (
    input instanceof Error ? input.message : typeof input === "string" ? input : ""
  ).toLowerCase();

  // Not configured at all. Distinct from "unreachable": nothing is going to fix
  // itself on a retry, so don't invite one.
  if (text.includes("no database connection is configured")) {
    return {
      message: "This app isn't finished setting up yet. Please check back shortly.",
      code: "database_not_configured",
      cause:
        "IMAGINE_DATABASE_URL and DATABASE_URL both absent — the environment did not " +
        "load. Not a retry case.",
      actionable: false,
    };
  }

  // Connectivity. Every one of these driver strings would name the vendor if shown.
  if (
    /econnrefused|enotfound|etimedout|econnreset|connection terminated|connection refused|timeout|socket hang up|too many clients|remaining connection slots/.test(
      text,
    )
  ) {
    return {
      message:
        context === "saving"
          ? "We couldn't save that just now. Nothing was lost — please try again in a moment."
          : "We couldn't load your data just now. Please try again in a moment.",
      code: "database_unreachable",
      cause:
        "Could not reach the database. Often a cold start on the first request after " +
        "idle, which succeeds on retry. Persistent failures mean the connection " +
        "string is wrong or the pool is exhausted (see `max` in @/db).",
      actionable: false,
    };
  }

  // Constraint violations. Users cause these, so they get a real explanation.
  if (text.includes("duplicate key") || text.includes("unique constraint") || text.includes("23505")) {
    return {
      message: "That already exists. Please use a different value.",
      code: "duplicate_value",
      cause: "Unique constraint violated. Check before inserting to say WHICH field.",
      actionable: true,
    };
  }
  if (text.includes("foreign key") || text.includes("23503")) {
    return {
      message: "That item no longer exists. Please refresh and try again.",
      code: "missing_reference",
      cause: "Foreign key violation — the referenced row was deleted, or the id is stale.",
      actionable: true,
    };
  }
  if (text.includes("not-null") || text.includes("23502")) {
    return {
      message: "Something required was missing. Please fill in every field and try again.",
      code: "missing_required_value",
      cause: "NOT NULL violation. Validate in the action before inserting.",
      actionable: true,
    };
  }

  // Schema drift — the classic "forgot db:push". Owner-side, and a retry won't help.
  if (
    text.includes("does not exist") ||
    text.includes("undefined table") ||
    text.includes("undefined column") ||
    text.includes("42p01") ||
    text.includes("42703")
  ) {
    return {
      message: "This part of the app isn't ready yet. The owner is finishing it off.",
      code: "schema_out_of_date",
      cause:
        "A table or column in the code is absent from the database — schema.ts changed " +
        "without `npm run db:push`. Run it.",
      actionable: false,
    };
  }

  // Transactions. Worth its own branch: it is the documented failure mode of the
  // wrong driver, and the raw message names the vendor outright.
  if (text.includes("no transactions support")) {
    return {
      message: "We couldn't complete that just now. Nothing was changed — please try again.",
      code: "transaction_unsupported",
      cause:
        "The HTTP database driver cannot run transactions. @/db is built on node-postgres " +
        "precisely so this cannot happen — if you see it, something replaced that " +
        "connection. Restore it.",
      actionable: false,
    };
  }

  if (context === "uploading") {
    return {
      message: "We couldn't upload that file. Please try again.",
      code: "upload_failed",
      cause: "Upload failed. See storage.ts for the typed cases (size, type, unavailable).",
      actionable: true,
    };
  }
  if (context === "email") {
    return {
      message: "We couldn't send that email just now. You can carry on using your account.",
      code: "email_failed",
      cause:
        "Send failed. sendEmail resolves false rather than throwing, so this must not " +
        "roll back work the person already completed.",
      actionable: false,
    };
  }

  return {
    message:
      context === "saving"
        ? "We couldn't save that just now. Please try again."
        : "We couldn't load that just now. Please try again.",
    code: "unexpected_error",
    cause: "Unclassified failure. Log the original and add a branch if it recurs.",
    actionable: false,
  };
}

/**
 * Convenience for a `catch` that only needs the sentence.
 *
 * Still logs the real reason first — a translated message with nothing written down
 * anywhere is how a bug becomes unreproducible.
 */
export function toUserMessage(
  input: unknown,
  context: "loading" | "saving" | "uploading" | "email" = "loading",
): string {
  const described = describeDataError(input, context);
  console.error("[error] %s — %s", described.code, described.cause);
  return described.message;
}
